CREATE TABLE study_preferences (
  user_id text NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 96),
  value jsonb NOT NULL,
  PRIMARY KEY (user_id, name)
);
