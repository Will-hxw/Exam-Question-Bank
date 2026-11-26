CREATE TABLE question_bank_positions (
  question_id uuid PRIMARY KEY REFERENCES questions (id),
  position integer NOT NULL UNIQUE CHECK (position > 0)
);

-- Freeze the live bank order before the first append.
INSERT INTO question_bank_positions(question_id, position)
SELECT id, (row_number() OVER (ORDER BY id))::int FROM questions;

CREATE VIEW active_bank_questions AS
SELECT q.*, o.position AS bank_position
FROM questions q
JOIN topics t ON t.id = q.topic_id AND t.active
LEFT JOIN question_bank_positions o ON o.question_id = q.id
WHERE q.status = 'published';

-- Remove current learning state as soon as a question is withdrawn.
CREATE FUNCTION forget_retired_question() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM favorites WHERE question_id = NEW.id;
  DELETE FROM question_progress WHERE question_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER forget_retired_question
AFTER UPDATE OF status ON questions
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'quarantined')
EXECUTE FUNCTION forget_retired_question();

DELETE FROM favorites f USING questions q
WHERE q.id = f.question_id AND q.status = 'quarantined';

DELETE FROM question_progress p USING questions q
WHERE q.id = p.question_id AND q.status = 'quarantined';

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
      -- Grade the original snapshot while keeping retired questions out of new activity.
      PERFORM 1 FROM questions q JOIN topics t ON t.id = q.topic_id
      WHERE q.id = item.question_id AND q.status = 'published' AND t.active FOR SHARE OF q;
      IF NOT FOUND THEN CONTINUE; END IF;
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

CREATE OR REPLACE FUNCTION replay_exam(owner text, source uuid) RETURNS TABLE (exam_id uuid, outcome text)
LANGUAGE plpgsql AS $$
DECLARE
  original exam_sessions%ROWTYPE;
  draft exam_sessions%ROWTYPE;
  new_exam uuid;
  original_order smallint[];
  replay_order smallint[];
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

  SELECT array_agg(i.position ORDER BY i.position) INTO original_order
  FROM exam_items i JOIN active_bank_questions q ON q.id = i.question_id
  WHERE i.exam_id = source;
  IF original_order IS NULL THEN RETURN QUERY SELECT NULL::uuid, 'retired'::text; RETURN; END IF;
  replay_order := original_order;
  IF cardinality(original_order) > 1 THEN
    -- Sample again if the shuffled order matches the source paper.
    LOOP
      SELECT array_agg(p.position ORDER BY random()) INTO replay_order FROM unnest(original_order) AS p(position);
      EXIT WHEN replay_order <> original_order;
    END LOOP;
  END IF;

  INSERT INTO exam_sessions (user_id, question_count, replay_of)
    VALUES (owner, cardinality(replay_order), source) RETURNING id INTO new_exam;
  INSERT INTO exam_items (exam_id, position, question_id, knowledge_point_id, question, answer_ids, review)
    SELECT new_exam, p.ordinality - 1, i.question_id, i.knowledge_point_id, i.question, i.answer_ids, i.review
    FROM unnest(replay_order) WITH ORDINALITY AS p(position, ordinality)
    JOIN exam_items i ON i.exam_id = source AND i.position = p.position;
  RETURN QUERY SELECT new_exam, 'ok'::text;
END;
$$;
