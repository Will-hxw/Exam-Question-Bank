CREATE TABLE chat_avatars (
  user_id text PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 12 AND 16384)
);
