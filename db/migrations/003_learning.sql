CREATE TABLE profiles (
  user_id text PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_progress (
  user_id text NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions (id),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  correct_streak smallint NOT NULL DEFAULT 0 CHECK (correct_streak BETWEEN 0 AND 1),
  is_wrong boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX wrong_questions_by_owner ON question_progress (user_id, question_id) WHERE is_wrong;

CREATE TABLE favorites (
  user_id text NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE attempts (
  user_id text NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES questions (id),
  selection uuid[] NOT NULL CHECK (cardinality(selection) BETWEEN 0 AND 6),
  correct boolean NOT NULL,
  mode text NOT NULL CHECK (mode IN ('practice', 'exam')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX attempts_by_user_question ON attempts (user_id, question_id);

CREATE FUNCTION count_answer(owner text, item uuid, is_correct boolean) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO question_progress (user_id, question_id, attempt_count, correct_streak, is_wrong)
    VALUES (owner, item, 1, 0, NOT is_correct)
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    attempt_count = question_progress.attempt_count + 1,
    correct_streak = CASE
      WHEN is_correct AND question_progress.is_wrong AND question_progress.correct_streak = 0 THEN 1
      ELSE 0
    END,
    is_wrong = NOT is_correct OR (question_progress.is_wrong AND question_progress.correct_streak = 0),
    updated_at = now();
$$;

CREATE FUNCTION record_practice_batch(owner text, events jsonb) RETURNS jsonb
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
    PERFORM count_answer(owner, item_key, correct);
    result := result || jsonb_build_object('eventId', event_key, 'status', 'saved', 'correct', correct);
  END LOOP;
  RETURN result;
END;
$$;

CREATE FUNCTION set_favorite(owner text, item uuid, enabled boolean) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT enabled THEN
    DELETE FROM favorites WHERE user_id = owner AND question_id = item;
    RETURN true;
  END IF;
  PERFORM 1 FROM questions q JOIN topics t ON q.topic_id = t.id
    WHERE q.id = item AND q.status = 'published' AND t.active FOR SHARE OF q;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO profiles (user_id) VALUES (owner) ON CONFLICT DO NOTHING;
  INSERT INTO favorites (user_id, question_id) VALUES (owner, item) ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
