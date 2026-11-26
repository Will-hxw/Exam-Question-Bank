ALTER TABLE chat_ai_requests ADD COLUMN proactive boolean NOT NULL DEFAULT false;

CREATE INDEX chat_ai_requests_proactive_recent ON chat_ai_requests (claimed_at DESC) WHERE proactive;

CREATE FUNCTION claim_chat_ai_request(source_id bigint, viewer text, thread uuid, unsolicited boolean)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  since timestamptz := clock_timestamp() - interval '1 minute';
  room_checks integer;
  viewer_checks integer;
  last_check timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('eqb/chat-ai-requests'));
  IF unsolicited THEN
    IF thread IS NOT NULL THEN RETURN false; END IF;
    SELECT count(*), count(*) FILTER (WHERE user_id = viewer), max(claimed_at)
      INTO room_checks, viewer_checks, last_check
      FROM chat_ai_requests WHERE proactive AND claimed_at > since;

    IF room_checks >= 10 OR viewer_checks >= 3 OR last_check > clock_timestamp() - interval '3 seconds'
      OR EXISTS (
        SELECT 1 FROM chat_ai_requests r JOIN chat_messages m ON m.ai_reply_to = r.message_id
        WHERE r.proactive AND r.claimed_at > since AND r.user_id <> viewer
          AND m.sent_at > clock_timestamp() - interval '15 seconds'
      ) THEN RETURN false;
    END IF;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE user_id = viewer)
      INTO room_checks, viewer_checks
      FROM chat_ai_requests WHERE NOT proactive AND claimed_at > since;
    IF room_checks >= 40 OR viewer_checks >= 8 THEN RETURN false; END IF;
  END IF;

  IF thread IS NULL THEN
    INSERT INTO chat_ai_requests (message_id, user_id, proactive)
    SELECT id, viewer, unsolicited FROM chat_messages
    WHERE id = source_id AND user_id = viewer AND ai_reply_to IS NULL
      AND (NOT unsolicited OR sent_at > clock_timestamp() - interval '30 seconds')
    ON CONFLICT (message_id) DO NOTHING;
  ELSE
    INSERT INTO chat_ai_requests (author_message_id, user_id)
    SELECT m.id, viewer FROM author_messages m JOIN author_conversations c ON c.id = m.conversation_id
    WHERE m.id = source_id AND c.id = thread AND c.user_id = viewer AND NOT m.from_author
    ON CONFLICT (author_message_id) DO NOTHING;
  END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION claim_chat_ai_request(source_id bigint, viewer text, thread uuid)
RETURNS boolean LANGUAGE sql AS $$
  SELECT claim_chat_ai_request(source_id, viewer, thread, false)
$$;
