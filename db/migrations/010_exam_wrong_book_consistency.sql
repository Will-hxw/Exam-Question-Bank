-- Submission and review classify every uncredited item the same way, including empty selections.
CREATE OR REPLACE FUNCTION update_exam(
  owner text, exam uuid, expected_revision integer, new_position integer,
  new_marked uuid[], new_answers jsonb, submit boolean
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  session exam_sessions%ROWTYPE;
  item exam_items%ROWTYPE;
  picked uuid[];
  correct boolean;
  final_score integer := 0;
BEGIN
  PERFORM 1 FROM profiles WHERE user_id = owner FOR UPDATE;
  SELECT * INTO session FROM exam_sessions WHERE id = exam AND user_id = owner FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF session.status = 'submitted' THEN
    IF submit THEN RETURN 'ok'; END IF;
    RETURN 'submitted';
  END IF;
  IF session.revision <> expected_revision THEN RETURN 'stale'; END IF;
  IF new_position IS NULL OR new_position < 0 OR new_position >= session.question_count THEN
    RETURN 'invalid_position';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT key::uuid AS id FROM jsonb_each(new_answers)
      UNION
      SELECT unnest(new_marked)
    ) AS changes
    WHERE NOT EXISTS (SELECT 1 FROM exam_items i WHERE i.exam_id = exam AND i.question_id = changes.id)
  ) THEN RETURN 'invalid'; END IF;

  FOR item IN SELECT * FROM exam_items i WHERE i.exam_id = exam ORDER BY i.position
  LOOP
    SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(new_answers->item.question_id::text, '[]')) ORDER BY value::uuid)
      INTO picked;
    IF (item.question->>'type' = 'single' AND cardinality(picked) > 1)
       OR (SELECT count(*) FROM jsonb_array_elements(item.question->'options') o
           WHERE (o->>'id')::uuid = ANY(picked)) <> cardinality(picked) THEN
      RETURN 'invalid';
    END IF;
  END LOOP;

  IF submit THEN
    FOR item IN SELECT * FROM exam_items i WHERE i.exam_id = exam ORDER BY i.position
    LOOP
      SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(new_answers->item.question_id::text, '[]')) ORDER BY value::uuid)
        INTO picked;
      correct := picked = item.answer_ids;
      IF correct THEN final_score := final_score + 1; END IF;
      INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
        VALUES (owner, gen_random_uuid(), item.question_id, picked, correct, 'exam');
      PERFORM count_answer(owner, item.question_id, correct, 'exam');
    END LOOP;
  END IF;
  UPDATE exam_sessions SET
    answers = new_answers, marked = new_marked, position = new_position, revision = revision + 1,
    status = CASE WHEN submit THEN 'submitted' ELSE 'draft' END,
    score = CASE WHEN submit THEN final_score ELSE NULL END,
    submitted_at = CASE WHEN submit THEN now() ELSE NULL END
  WHERE id = exam;
  RETURN 'ok';
END;
$$;

-- Recover losses omitted after 008. A later progress update can be a manual removal,
-- so leave a later cleared flag in place rather than reconstructing it from history.
WITH omitted AS (
  SELECT s.user_id, i.question_id, s.submitted_at
  FROM exam_sessions s
  JOIN exam_items i ON i.exam_id = s.id
  LEFT JOIN question_progress p ON p.user_id = s.user_id AND p.question_id = i.question_id
  WHERE s.status = 'submitted'
    AND s.submitted_at >= (SELECT applied_at FROM schema_migrations WHERE file = '008_wrong_book_and_exam_replay.sql')
    AND jsonb_array_length(COALESCE(s.answers->i.question_id::text, '[]')) = 0
    AND (p.is_wrong OR p.updated_at <= s.submitted_at OR p.user_id IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM attempts a
      WHERE a.user_id = s.user_id AND a.question_id = i.question_id AND a.mode = 'exam'
        AND a.created_at = s.submitted_at AND cardinality(a.selection) = 0
    )
), recorded AS (
  INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode, created_at)
    SELECT user_id, gen_random_uuid(), question_id, ARRAY[]::uuid[], false, 'exam', submitted_at FROM omitted
  RETURNING user_id, question_id, created_at
)
INSERT INTO question_progress (user_id, question_id, attempt_count, correct_streak, is_wrong, updated_at)
  SELECT user_id, question_id, count(*)::integer, 0, true, max(created_at)
  FROM recorded GROUP BY user_id, question_id
ON CONFLICT (user_id, question_id) DO UPDATE SET
  attempt_count = question_progress.attempt_count + EXCLUDED.attempt_count,
  correct_streak = 0,
  is_wrong = question_progress.is_wrong OR question_progress.updated_at <= EXCLUDED.updated_at,
  updated_at = greatest(question_progress.updated_at, EXCLUDED.updated_at);
