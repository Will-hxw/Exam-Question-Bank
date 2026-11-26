CREATE TABLE author_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE REFERENCES profiles (user_id) ON DELETE CASCADE,
  default_nickname text NOT NULL,
  last_user_id bigint NOT NULL DEFAULT 0,
  last_author_id bigint NOT NULL DEFAULT 0,
  user_read_id bigint NOT NULL DEFAULT 0,
  author_read_id bigint NOT NULL DEFAULT 0,
  last_message_id bigint GENERATED ALWAYS AS (greatest(last_user_id, last_author_id)) STORED
);

CREATE INDEX author_conversations_recent ON author_conversations (last_message_id DESC);
CREATE INDEX author_conversations_unread ON author_conversations (id) WHERE last_user_id > author_read_id;

CREATE TABLE author_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES author_conversations (id) ON DELETE CASCADE,
  from_author boolean NOT NULL,
  client_id uuid,
  ai_reply_to bigint UNIQUE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (conversation_id, from_author, client_id)
);

CREATE INDEX author_messages_by_conversation ON author_messages (conversation_id, id DESC);
CREATE INDEX author_messages_sent_recently ON author_messages (conversation_id, from_author, sent_at DESC) WHERE client_id IS NOT NULL;

CREATE FUNCTION open_author_chat(viewer text, greeting text, nickname text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  thread uuid;
  greeting_id bigint;
BEGIN
  SELECT id INTO thread FROM author_conversations WHERE user_id = viewer;
  IF FOUND THEN RETURN thread; END IF;

  INSERT INTO profiles (user_id) VALUES (viewer) ON CONFLICT DO NOTHING;
  INSERT INTO author_conversations (user_id, default_nickname) VALUES (viewer, nickname)
    ON CONFLICT (user_id) DO NOTHING RETURNING id INTO thread;
  IF NOT FOUND THEN
    SELECT id INTO thread FROM author_conversations WHERE user_id = viewer;
    RETURN thread;
  END IF;

  INSERT INTO author_messages (conversation_id, from_author, body)
  VALUES (thread, true, greeting)
  RETURNING id INTO greeting_id;
  UPDATE author_conversations SET last_author_id = greeting_id WHERE id = thread;
  RETURN thread;
END;
$$;

CREATE FUNCTION send_author_message(thread uuid, viewer text, author boolean, event_id uuid, content text, reply_to bigint DEFAULT NULL)
RETURNS author_messages LANGUAGE plpgsql AS $$
DECLARE
  message author_messages%ROWTYPE;
BEGIN
  -- Readers can advance their cursor safely because sends in a thread commit in ID order.
  PERFORM id FROM author_conversations WHERE id = thread AND (author OR user_id = viewer) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO message FROM author_messages
    WHERE conversation_id = thread AND from_author = author AND (client_id = event_id OR ai_reply_to = reply_to);
  IF FOUND THEN RETURN message; END IF;

  IF reply_to IS NULL AND EXISTS (
    SELECT 1 FROM author_messages
    WHERE conversation_id = thread AND from_author = author AND client_id IS NOT NULL
      AND sent_at > clock_timestamp() - interval '1 second'
  ) THEN RETURN NULL; END IF;

  INSERT INTO author_messages (conversation_id, from_author, client_id, body, ai_reply_to)
  VALUES (thread, author, event_id, content, reply_to)
  RETURNING * INTO message;

  UPDATE author_conversations SET
    last_author_id = CASE WHEN author THEN message.id ELSE last_author_id END,
    last_user_id = CASE WHEN author THEN last_user_id ELSE message.id END
  WHERE id = thread;
  RETURN message;
END;
$$;
