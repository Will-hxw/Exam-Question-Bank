ALTER TABLE author_conversations ADD COLUMN user_opened boolean NOT NULL DEFAULT true;
ALTER TABLE author_conversations ALTER COLUMN user_opened SET DEFAULT false;

CREATE OR REPLACE FUNCTION open_author_chat(viewer text, greeting text, nickname text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  thread uuid;
  greeting_id bigint;
BEGIN
  SELECT id INTO thread FROM author_conversations WHERE user_id = viewer;
  IF NOT FOUND THEN
    INSERT INTO profiles (user_id) VALUES (viewer) ON CONFLICT DO NOTHING;
    INSERT INTO author_conversations (user_id, default_nickname) VALUES (viewer, nickname)
      ON CONFLICT (user_id) DO NOTHING RETURNING id INTO thread;
    IF NOT FOUND THEN
      SELECT id INTO thread FROM author_conversations WHERE user_id = viewer;
    END IF;
  END IF;

  IF greeting IS NULL THEN RETURN thread; END IF;

  -- The first student open and any concurrent sends share the conversation row lock.
  UPDATE author_conversations SET user_opened = true WHERE id = thread AND NOT user_opened;
  IF NOT FOUND THEN RETURN thread; END IF;

  INSERT INTO author_messages (conversation_id, from_author, body)
  VALUES (thread, true, greeting) RETURNING id INTO greeting_id;
  UPDATE author_conversations SET last_author_id = greeting_id WHERE id = thread;
  RETURN thread;
END;
$$;
