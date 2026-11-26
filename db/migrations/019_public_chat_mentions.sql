ALTER TABLE chat_profiles
  DROP CONSTRAINT chat_profiles_nickname_check,
  ADD CHECK (length(nickname) BETWEEN 1 AND 48);

ALTER TABLE chat_messages
  DROP CONSTRAINT chat_messages_nickname_check,
  ADD CHECK (length(nickname) BETWEEN 1 AND 48),
  ADD COLUMN ai_reply_to bigint UNIQUE;

CREATE TABLE chat_ai_requests (
  message_id bigint UNIQUE REFERENCES chat_messages (id) ON DELETE CASCADE,
  author_message_id bigint UNIQUE REFERENCES author_messages (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((message_id IS NULL) <> (author_message_id IS NULL))
);
CREATE INDEX chat_ai_requests_recent ON chat_ai_requests (claimed_at DESC);
CREATE INDEX chat_ai_requests_by_user ON chat_ai_requests (user_id, message_id) WHERE message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION send_chat_message(owner text, event_id uuid, content text, default_nickname text, default_avatar smallint)
RETURNS chat_messages LANGUAGE plpgsql AS $$
DECLARE
  message chat_messages%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('eqb/chat-room'));
  SELECT * INTO message FROM chat_messages WHERE user_id = owner AND client_id = event_id;
  IF FOUND THEN RETURN message; END IF;

  IF (SELECT sent_at FROM chat_messages WHERE user_id = owner AND ai_reply_to IS NULL ORDER BY id DESC LIMIT 1)
      > clock_timestamp() - interval '1 second' THEN
    RETURN NULL;
  END IF;

  INSERT INTO profiles (user_id) VALUES (owner) ON CONFLICT DO NOTHING;
  INSERT INTO chat_messages (user_id, client_id, nickname, avatar, body)
  VALUES (owner, event_id, COALESCE(
    (SELECT nickname FROM chat_profiles WHERE user_id = owner), default_nickname
  ), default_avatar, content)
  RETURNING * INTO message;
  RETURN message;
END;
$$;

CREATE FUNCTION claim_chat_ai_request(source_id bigint, viewer text, thread uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('eqb/chat-ai-requests'));
  IF EXISTS (
    SELECT 1 FROM chat_ai_requests
    WHERE (thread IS NULL AND message_id = source_id) OR (thread IS NOT NULL AND author_message_id = source_id)
  )
    OR (SELECT count(*) FROM chat_ai_requests WHERE user_id = viewer AND claimed_at > clock_timestamp() - interval '1 minute') >= 8
    OR (SELECT count(*) FROM chat_ai_requests WHERE claimed_at > clock_timestamp() - interval '1 minute') >= 40
  THEN RETURN false; END IF;
  IF thread IS NULL THEN
    INSERT INTO chat_ai_requests (message_id, user_id)
    SELECT id, viewer FROM chat_messages WHERE id = source_id AND user_id = viewer AND ai_reply_to IS NULL;
  ELSE
    INSERT INTO chat_ai_requests (author_message_id, user_id)
    SELECT m.id, viewer FROM author_messages m JOIN author_conversations c ON c.id = m.conversation_id
    WHERE m.id = source_id AND c.id = thread AND c.user_id = viewer AND NOT m.from_author;
  END IF;
  RETURN FOUND;
END;
$$;
