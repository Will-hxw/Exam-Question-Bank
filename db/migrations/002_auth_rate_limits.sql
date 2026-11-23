CREATE TABLE auth_rate_limits (
  bucket text PRIMARY KEY CHECK (bucket ~ '^[0-9a-f]{64}$'),
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL
);

CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits (expires_at);
