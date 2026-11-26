CREATE OR REPLACE FUNCTION claim_signup_followup() RETURNS TABLE (user_id text, email text, attempts smallint)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue_signup_followups();

  RETURN QUERY
  WITH candidate AS (
    SELECT u.id::text AS user_id, u.email::text AS email
    FROM signup_followup_deliveries d
    JOIN neon_auth."user" u ON u.id::text = d.user_id
    WHERE u."emailVerified"
      AND (d.state = 'waiting' OR (
        d.state = 'retryable' AND d.attempts < 6 AND d.retry_at <= statement_timestamp()
      ))
      AND EXISTS (
        SELECT 1 FROM attempts a
        WHERE a.user_id = d.user_id AND cardinality(a.selection) > 0
        LIMIT 1 OFFSET 19
      )
      AND NOT EXISTS (
        SELECT 1 FROM signup_followup_deliveries paused
        WHERE paused.failure = 'smtp_auth'
          AND paused.updated_at > statement_timestamp() - interval '1 hour'
      )
    ORDER BY d.verified_at, d.user_id
    LIMIT 1
  ), claimed AS (
    UPDATE signup_followup_deliveries d
      SET state = 'sending', attempts = d.attempts + 1, failure = NULL,
        retry_at = NULL, updated_at = statement_timestamp()
      FROM candidate c WHERE d.user_id = c.user_id
        AND (d.state = 'waiting' OR (
          d.state = 'retryable' AND d.attempts < 6 AND d.retry_at <= statement_timestamp()
        ))
      RETURNING d.user_id, d.attempts
  )
  SELECT c.user_id, c.email, d.attempts FROM claimed d JOIN candidate c ON c.user_id = d.user_id;
END;
$$;
