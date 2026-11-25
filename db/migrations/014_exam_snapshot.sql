CREATE FUNCTION exam_snapshot(owner text, exam_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(snapshot)
  FROM (
    SELECT s.id, s.status,
      to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt",
      to_char(s.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt",
      s.revision, s.position, s.score, s.question_count AS total, s.answers, s.marked,
      (SELECT jsonb_agg(
        i.question || CASE WHEN s.status = 'submitted'
          THEN i.review || jsonb_build_object('answerIds', i.answer_ids) ELSE '{}'::jsonb END
        ORDER BY i.position)
        FROM exam_items i WHERE i.exam_id = s.id) AS items,
      CASE WHEN s.status = 'submitted' THEN (
        SELECT jsonb_object_agg(i.question_id,
          i.answer_ids = ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(s.answers->i.question_id::text, '[]'))
            ORDER BY value::uuid))
        FROM exam_items i WHERE i.exam_id = s.id
      ) END AS correctness
    FROM exam_sessions s WHERE s.user_id = owner AND s.id = exam_id
  ) snapshot;
$$;

CREATE FUNCTION start_exam_snapshot(owner text, items uuid[]) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  draft_id uuid;
BEGIN
  draft_id := start_exam(owner, items);
  RETURN exam_snapshot(owner, draft_id);
END;
$$;
