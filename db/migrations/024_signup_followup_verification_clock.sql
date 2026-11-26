CREATE TABLE signup_followup_scheduler (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_digest text NOT NULL CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  last_scheduled_at timestamptz,
  last_checked_at timestamptz
);

-- On signup completion the Auth user update supplies the timestamp. For existing
-- accounts the stored verification time can only move earlier, never restart.
CREATE FUNCTION record_signup_followup_verifications(recipient text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO signup_followup_deliveries AS d (user_id, state, attempts, verified_at)
    SELECT u.id::text, 'waiting', 0, greatest(u."createdAt", u."updatedAt")
    FROM neon_auth."user" u
    LEFT JOIN signup_followup_deliveries existing ON existing.user_id = u.id::text
    WHERE u."emailVerified" AND (recipient IS NULL OR u.email = recipient)
      AND (existing.user_id IS NULL OR (
        existing.state = 'waiting' AND existing.verified_at > greatest(u."createdAt", u."updatedAt")
      ))
    ON CONFLICT ON CONSTRAINT signup_followup_deliveries_pkey DO UPDATE
      SET verified_at = EXCLUDED.verified_at
      WHERE d.state = 'waiting' AND d.verified_at > EXCLUDED.verified_at;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_signup_followups() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM record_signup_followup_verifications(NULL::text);
END;
$$;
