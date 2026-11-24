-- All existing sessions were created by start_exam with exactly 50 items.
ALTER TABLE exam_sessions
  ADD COLUMN question_count smallint NOT NULL DEFAULT 50 CHECK (question_count BETWEEN 1 AND 100),
  DROP CONSTRAINT exam_sessions_score_check,
  DROP CONSTRAINT exam_sessions_position_check;

ALTER TABLE exam_sessions
  ADD CONSTRAINT exam_sessions_score_check CHECK (score BETWEEN 0 AND question_count),
  ADD CONSTRAINT exam_sessions_position_check CHECK (position >= 0 AND position < question_count);

ALTER TABLE exam_items DROP CONSTRAINT exam_items_position_check;
ALTER TABLE exam_items ADD CONSTRAINT exam_items_position_check CHECK (position BETWEEN 0 AND 99);

CREATE OR REPLACE FUNCTION start_exam(owner text, items uuid[]) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  new_exam uuid;
  item_count integer := cardinality(items);
  inserted integer;
BEGIN
  INSERT INTO profiles (user_id) VALUES (owner) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM profiles WHERE user_id = owner FOR UPDATE;
  SELECT id INTO new_exam FROM exam_sessions WHERE user_id = owner AND status = 'draft';
  IF FOUND THEN RETURN new_exam; END IF;
  IF item_count IS NULL OR item_count NOT BETWEEN 1 AND 100 THEN RETURN NULL; END IF;

  INSERT INTO exam_sessions (user_id, question_count) VALUES (owner, item_count) RETURNING id INTO new_exam;
  PERFORM 1 FROM questions q JOIN topics t ON t.id = q.topic_id
    WHERE q.id = ANY(items) AND q.status = 'published' AND t.active ORDER BY q.id FOR SHARE OF q;
  INSERT INTO exam_items (exam_id, position, question_id, knowledge_point_id, question, answer_ids, review)
    SELECT new_exam, x.position - 1, q.id, q.knowledge_point_id,
      jsonb_build_object('id', q.id, 'type', q.type, 'stem', q.stem, 'topicId', q.topic_id, 'options', (
        SELECT jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) ORDER BY o.position)
          FROM question_options o WHERE o.question_id = q.id
      )),
      (SELECT array_agg(a.option_id ORDER BY a.option_id) FROM question_answers a WHERE a.question_id = q.id),
      jsonb_build_object('explanation', e.explanation, 'options', (
        SELECT jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'rationale', o.rationale) ORDER BY o.position)
          FROM question_options o WHERE o.question_id = q.id
      ), 'sources', (
        SELECT jsonb_agg(source ORDER BY source->>'title', source->>'location') FROM (
          SELECT DISTINCT jsonb_build_object('title', s.title, 'url', s.url, 'location', ev.location) AS source
            FROM question_evidence ev JOIN sources s ON s.id = ev.source_id WHERE ev.question_id = q.id
        ) AS distinct_sources
      ))
    FROM unnest(items) WITH ORDINALITY AS x(id, position)
    JOIN questions q ON q.id = x.id
    JOIN topics t ON t.id = q.topic_id AND t.active
    JOIN question_explanations e ON e.question_id = q.id
    WHERE q.status = 'published';
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted <> item_count THEN
    DELETE FROM exam_sessions WHERE id = new_exam;
    RETURN NULL;
  END IF;
  RETURN new_exam;
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
      INSERT INTO attempts (user_id, event_id, question_id, selection, correct, mode)
        VALUES (owner, gen_random_uuid(), item.question_id, picked, correct, 'exam');
      PERFORM count_answer(owner, item.question_id, correct);
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
