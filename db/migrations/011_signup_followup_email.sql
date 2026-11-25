CREATE TABLE signup_followup_deliveries (
  user_id text PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN ('sending', 'sent', 'retryable', 'failed', 'uncertain')),
  attempts smallint NOT NULL CHECK (attempts BETWEEN 1 AND 6),
  failure text,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  retry_at timestamptz,
  CHECK ((state = 'retryable') = (retry_at IS NOT NULL))
);

CREATE FUNCTION claim_signup_followup() RETURNS TABLE (user_id text, email text, attempts smallint)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT u.id::text AS user_id, u.email::text AS email
    FROM neon_auth."user" u
    LEFT JOIN signup_followup_deliveries d ON d.user_id = u.id::text
    WHERE u."emailVerified"
      AND u."createdAt" >= (
        SELECT applied_at FROM schema_migrations WHERE file = '011_signup_followup_email.sql'
      )
      AND (d.user_id IS NULL OR (
        d.state = 'retryable' AND d.attempts < 6 AND d.retry_at <= statement_timestamp()
      ))
      AND NOT EXISTS (
        SELECT 1 FROM signup_followup_deliveries paused
        WHERE paused.failure = 'smtp_auth'
          AND paused.updated_at > statement_timestamp() - interval '1 hour'
      )
      AND (
        u."createdAt" <= statement_timestamp() - interval '24 hours'
        OR EXISTS (
          SELECT 1 FROM attempts a
          WHERE a.user_id = u.id::text AND cardinality(a.selection) > 0
          LIMIT 1 OFFSET 60
        )
      )
    ORDER BY u."createdAt", u.id
    LIMIT 1
  ), claimed AS (
    INSERT INTO signup_followup_deliveries AS d (user_id, state, attempts)
      SELECT c.user_id, 'sending', 1 FROM candidate c
      ON CONFLICT ON CONSTRAINT signup_followup_deliveries_pkey DO UPDATE SET
        state = 'sending', attempts = d.attempts + 1, failure = NULL,
        retry_at = NULL, updated_at = statement_timestamp()
      WHERE d.state = 'retryable' AND d.attempts < 6 AND d.retry_at <= statement_timestamp()
      RETURNING d.user_id, d.attempts
  )
  SELECT c.user_id, c.email, d.attempts FROM claimed d JOIN candidate c ON c.user_id = d.user_id;
END;
$$;
