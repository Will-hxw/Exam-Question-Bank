CREATE TABLE chat_profiles (
  user_id text PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 24)
);

CREATE TABLE chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 24),
  avatar smallint NOT NULL CHECK (avatar BETWEEN 0 AND 35),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX chat_messages_by_author ON chat_messages (user_id, id DESC);

CREATE FUNCTION send_chat_message(owner text, event_id uuid, content text, default_nickname text, default_avatar smallint)
RETURNS chat_messages LANGUAGE plpgsql AS $$
DECLARE
  message chat_messages%ROWTYPE;
BEGIN
  -- Assign message IDs in commit order so incremental readers cannot skip late commits.
  PERFORM pg_advisory_xact_lock(hashtext('eqb/chat-room'));
  SELECT * INTO message FROM chat_messages WHERE user_id = owner AND client_id = event_id;
  IF FOUND THEN
    RETURN message;
  END IF;

  IF (SELECT sent_at FROM chat_messages WHERE user_id = owner ORDER BY id DESC LIMIT 1)
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
