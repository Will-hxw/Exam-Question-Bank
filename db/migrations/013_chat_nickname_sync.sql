CREATE SEQUENCE chat_nickname_revision;

ALTER TABLE chat_profiles
  ADD COLUMN nickname_revision bigint NOT NULL DEFAULT 0;

CREATE INDEX chat_profiles_by_nickname_revision
  ON chat_profiles (nickname_revision) WHERE nickname_revision > 0;
