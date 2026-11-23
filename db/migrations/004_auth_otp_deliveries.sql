CREATE TABLE auth_otp_deliveries (
  event_id uuid PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('sending', 'sent', 'retryable', 'failed', 'uncertain')),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  failure text CHECK (failure IN (
    'smtp_auth', 'smtp_temporary_rejection', 'smtp_rejection', 'smtp_connection', 'smtp_unconfirmed'
  )),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX auth_otp_deliveries_expiry ON auth_otp_deliveries (expires_at);
