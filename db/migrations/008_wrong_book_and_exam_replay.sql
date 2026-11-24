-- Existing progress stays intact; new attempts use the explicit answer source.
CREATE FUNCTION count_answer(owner text, item uuid, is_correct boolean, answer_mode text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO question_progress (user_id, question_id, attempt_count, correct_streak, is_wrong)
    VALUES (owner, item, 1, 0, NOT is_correct AND (
      answer_mode = 'exam' OR NOT EXISTS (
        SELECT 1 FROM attempts a WHERE a.user_id = owner AND a.question_id = item AND a.mode = 'practice'
        OFFSET 1
      )
    ))
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    attempt_count = question_progress.attempt_count + 1,
    correct_streak = 0,
    is_wrong = question_progress.is_wrong OR EXCLUDED.is_wrong,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION record_practice_batch(owner text, events jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  event jsonb;
  event_key uuid;
  item_key uuid;
  item_type text;
  picked uuid[];
  correct_ids uuid[];
  previous attempts%ROWTYPE;
  result jsonb := '[]'::jsonb;
  correct boolean;
BEGIN
  INSERT INTO profiles (user_id) VALUES (owner) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM profiles WHERE user_id = owner FOR UPDATE;
  FOR event IN SELECT * FROM jsonb_array_elements(events)
  LOOP
    event_key := (event->>'eventId')::uuid;
    item_key := (event->>'questionId')::uuid;
    SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(event->'optionIds') ORDER BY value::uuid) INTO picked;
    SELECT * INTO previous FROM attempts a WHERE a.user_id = owner AND a.event_id = event_key;
    IF FOUND THEN
      IF previous.question_id <> item_key OR previous.selection <> picked OR previous.mode <> 'practice' THEN
        result := result || jsonb_build_object('eventId', event_key, 'status', 'conflict');
      ELSE
        result := result || jsonb_build_object('eventId', event_key, 'status', 'saved', 'correct', previous.correct);
      END IF;
      CONTINUE;
    END IF;
    SELECT q.type INTO item_type FROM questions q JOIN topics t ON t.id = q.topic_id
      WHERE q.id = item_key AND q.status = 'published' AND t.active FOR SHARE OF q;
    IF NOT FOUND THEN
      result := result || jsonb_build_object('eventId', event_key, 'status', 'unavailable');
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM questions q WHERE q.id = item_key
        AND q.content_revision IS DISTINCT FROM event->>'contentRevision'
    ) THEN
      result := result || jsonb_build_object('eventId', event_key, 'status', 'unavailable');
      CONTINUE;
    END IF;
    IF cardinality(picked) = 0 OR (item_type = 'single' AND cardinality(picked) <> 1)
       OR (SELECT count(*) FROM question_options o WHERE o.question_id = item_key AND o.id = ANY(picked)) <> cardinality(picked) THEN
      result := result || jsonb_build_object('eventId', event_key, 'status', 'invalid_options');
      CONTINUE;
    END IF;
    SELECT array_agg(a.option_id ORDER BY a.option_id) INTO correct_ids FROM question_answers a WHERE a.question_id = item_key;
    correct := correct_ids = picked;
    INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
      VALUES (owner, event_key, item_key, picked, correct, 'practice');
    PERFORM count_answer(owner, item_key, correct, 'practice');
    result := result || jsonb_build_object('eventId', event_key, 'status', 'saved', 'correct', correct);
  END LOOP;
  RETURN result;
END;
$$;

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
      IF cardinality(picked) = 0 THEN CONTINUE; END IF;
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

DROP FUNCTION count_answer(text, uuid, boolean);

ALTER TABLE exam_sessions ADD COLUMN replay_of uuid REFERENCES exam_sessions (id) ON DELETE SET NULL;

CREATE FUNCTION replay_exam(owner text, source uuid) RETURNS TABLE (exam_id uuid, outcome text)
LANGUAGE plpgsql AS $$
DECLARE
  original exam_sessions%ROWTYPE;
  draft exam_sessions%ROWTYPE;
  new_exam uuid;
BEGIN
  PERFORM 1 FROM profiles WHERE user_id = owner FOR UPDATE;
  SELECT * INTO original FROM exam_sessions WHERE id = source AND user_id = owner AND status = 'submitted';
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid, 'missing'::text; RETURN; END IF;

  SELECT * INTO draft FROM exam_sessions WHERE user_id = owner AND status = 'draft';
  IF FOUND THEN
    IF draft.replay_of = source THEN RETURN QUERY SELECT draft.id, 'ok'::text;
    ELSE RETURN QUERY SELECT NULL::uuid, 'draft'::text;
    END IF;
    RETURN;
  END IF;

  INSERT INTO exam_sessions (user_id, question_count, replay_of)
    VALUES (owner, original.question_count, source) RETURNING id INTO new_exam;
  INSERT INTO exam_items (exam_id, position, question_id, knowledge_point_id, question, answer_ids, review)
    SELECT new_exam, i.position, i.question_id, i.knowledge_point_id, i.question, i.answer_ids, i.review
    FROM exam_items i WHERE i.exam_id = source ORDER BY i.position;
  RETURN QUERY SELECT new_exam, 'ok'::text;
END;
$$;
