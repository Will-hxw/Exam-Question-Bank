CREATE TABLE chat_reads (
  user_id text PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL CHECK (last_read_id > 0)
);
