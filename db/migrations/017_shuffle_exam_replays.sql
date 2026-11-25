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

  SELECT array_agg(i.position ORDER BY i.position) INTO original_order FROM exam_items i WHERE i.exam_id = source;
  replay_order := original_order;
  IF cardinality(original_order) > 1 THEN
    -- Sample again if the shuffled order matches the source paper.
    LOOP
      SELECT array_agg(p.position ORDER BY random()) INTO replay_order FROM unnest(original_order) AS p(position);
      EXIT WHEN replay_order <> original_order;
    END LOOP;
  END IF;

  INSERT INTO exam_sessions (user_id, question_count, replay_of)
    VALUES (owner, original.question_count, source) RETURNING id INTO new_exam;
  INSERT INTO exam_items (exam_id, position, question_id, knowledge_point_id, question, answer_ids, review)
    SELECT new_exam, p.ordinality - 1, i.question_id, i.knowledge_point_id, i.question, i.answer_ids, i.review
    FROM unnest(replay_order) WITH ORDINALITY AS p(position, ordinality)
    JOIN exam_items i ON i.exam_id = source AND i.position = p.position;
  RETURN QUERY SELECT new_exam, 'ok'::text;
END;
$$;
