CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE topics (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  sort_order integer NOT NULL UNIQUE CHECK (sort_order > 0),
  scope_note text NOT NULL CHECK (btrim(scope_note) <> ''),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE sources (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  publisher text NOT NULL CHECK (btrim(publisher) <> ''),
  url text NOT NULL CHECK (url ~ '^https://[^[:space:]]+$'),
  attachment_url text CHECK (attachment_url ~ '^https://[^[:space:]]+$'),
  document_date date,
  webpage_date date,
  effective_from date,
  effective_to date,
  retrieved_on date,
  access_status text NOT NULL CHECK (access_status IN ('full', 'partial', 'index', 'restricted', 'unavailable', 'pending')),
  media_type text NOT NULL DEFAULT 'html',
  page_count integer CHECK (page_count > 0),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  rights_note text NOT NULL,
  superseded_by text REFERENCES sources (id),
  CHECK (effective_to IS NULL OR effective_from <= effective_to),
  CHECK (superseded_by IS DISTINCT FROM id)
);

CREATE TABLE knowledge_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id text NOT NULL REFERENCES topics (id),
  fact_key text NOT NULL UNIQUE CHECK (btrim(fact_key) <> ''),
  fact text NOT NULL CHECK (btrim(fact) <> ''),
  importance text NOT NULL CHECK (importance IN ('core', 'general')),
  source_id text NOT NULL REFERENCES sources (id),
  location text NOT NULL CHECK (btrim(location) <> ''),
  scope_note text NOT NULL CHECK (btrim(scope_note) <> ''),
  UNIQUE (id, topic_id)
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id text NOT NULL REFERENCES topics (id),
  knowledge_point_id uuid NOT NULL,
  FOREIGN KEY (knowledge_point_id, topic_id) REFERENCES knowledge_points (id, topic_id) DEFERRABLE,
  type text NOT NULL CHECK (type IN ('single', 'multiple')),
  stem text NOT NULL CHECK (btrim(stem) <> ''),
  search_text text NOT NULL CHECK (btrim(search_text) <> ''),
  scope_note text NOT NULL CHECK (btrim(scope_note) <> ''),
  difficulty text NOT NULL CHECK (difficulty IN ('basic', 'intermediate', 'advanced')),
  task_type text NOT NULL CHECK (task_type IN ('recall', 'distinction', 'application')),
  difficulty_reason text NOT NULL CHECK (btrim(difficulty_reason) <> ''),
  emotion_only boolean NOT NULL,
  emotion_reason text NOT NULL CHECK (btrim(emotion_reason) <> ''),
  order_locked boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'published', 'quarantined')),
  content_revision text CHECK (content_revision ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX published_primary_fact ON questions (knowledge_point_id) WHERE status = 'published';
CREATE INDEX published_topic_questions ON questions (topic_id, id) WHERE status = 'published';
CREATE INDEX published_type_questions ON questions (type, id) WHERE status = 'published';
CREATE INDEX published_search_questions ON questions USING gin (search_text gin_trgm_ops) WHERE status = 'published';

CREATE TABLE question_options (
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  text text NOT NULL CHECK (btrim(text) <> ''),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  PRIMARY KEY (question_id, id),
  UNIQUE (question_id, position) DEFERRABLE INITIALLY IMMEDIATE,
  UNIQUE (question_id, text)
);

CREATE TABLE question_answers (
  question_id uuid NOT NULL,
  option_id uuid NOT NULL,
  PRIMARY KEY (question_id, option_id),
  FOREIGN KEY (question_id, option_id) REFERENCES question_options (question_id, id) ON DELETE CASCADE
);

CREATE TABLE question_explanations (
  question_id uuid PRIMARY KEY REFERENCES questions (id) ON DELETE CASCADE,
  explanation text NOT NULL CHECK (btrim(explanation) <> ''),
  distinction text NOT NULL CHECK (btrim(distinction) <> '')
);

CREATE TABLE question_knowledge_points (
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  knowledge_point_id uuid NOT NULL REFERENCES knowledge_points (id),
  PRIMARY KEY (question_id, knowledge_point_id)
);

CREATE TABLE question_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  option_id uuid,
  source_id text NOT NULL REFERENCES sources (id),
  location text NOT NULL CHECK (btrim(location) <> ''),
  claim text NOT NULL CHECK (btrim(claim) <> ''),
  FOREIGN KEY (question_id, option_id) REFERENCES question_options (question_id, id),
  UNIQUE NULLS NOT DISTINCT (question_id, option_id, source_id, location, claim)
);

CREATE TABLE question_reviews (
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('initial', 'independent')),
  reviewer text NOT NULL CHECK (btrim(reviewer) <> ''),
  outcome text NOT NULL CHECK (outcome IN ('approved', 'changes', 'rejected')),
  independently_selected uuid[] NOT NULL CHECK (cardinality(independently_selected) BETWEEN 1 AND 6),
  emotion_only boolean NOT NULL,
  notes text NOT NULL CHECK (btrim(notes) <> ''),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, phase)
);

CREATE TABLE duplicate_reviews (
  first_question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  second_question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'duplicate', 'distinct', 'needs_rewrite')),
  reviewer text NOT NULL CHECK (btrim(reviewer) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (first_question_id, second_question_id),
  CHECK (first_question_id < second_question_id)
);

CREATE FUNCTION question_digest(target uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    q.id, q.topic_id, q.knowledge_point_id, q.type, q.stem, q.scope_note,
    q.difficulty, q.difficulty_reason, q.task_type, q.emotion_only, q.emotion_reason, q.order_locked,
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.position) FROM question_options o WHERE o.question_id = q.id),
    (SELECT jsonb_agg(a.option_id ORDER BY a.option_id) FROM question_answers a WHERE a.question_id = q.id),
    (SELECT to_jsonb(e) FROM question_explanations e WHERE e.question_id = q.id),
    (SELECT jsonb_agg(jsonb_build_array(e.option_id, e.source_id, e.location, e.claim) ORDER BY e.id)
       FROM question_evidence e WHERE e.question_id = q.id),
    (SELECT jsonb_agg(k.knowledge_point_id ORDER BY k.knowledge_point_id)
       FROM question_knowledge_points k WHERE k.question_id = q.id)
  )::text, 'UTF8')), 'hex')
  FROM questions q WHERE q.id = target;
$$;

CREATE FUNCTION check_published_question() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  correct_ids uuid[];
  number_of_options integer;
  digest text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('approved', 'published') THEN
      RAISE EXCEPTION 'Insert questions in reviewable state before adding evidence';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('approved', 'published')
     AND (to_jsonb(OLD) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
         (to_jsonb(NEW) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'Return the question to review before changing content';
  END IF;
  IF NEW.status NOT IN ('approved', 'published') THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(option_id ORDER BY option_id) INTO correct_ids
    FROM question_answers WHERE question_id = NEW.id;
  SELECT count(*) INTO number_of_options FROM question_options WHERE question_id = NEW.id;
  IF number_of_options < 2 OR correct_ids IS NULL
     OR (NEW.type = 'single' AND cardinality(correct_ids) <> 1)
     OR (NEW.type = 'multiple' AND cardinality(correct_ids) < 2)
     OR NOT EXISTS (SELECT 1 FROM question_explanations WHERE question_id = NEW.id) THEN
    RAISE EXCEPTION 'Question requires valid answers and a fixed explanation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM question_evidence WHERE question_id = NEW.id AND option_id IS NULL)
     OR EXISTS (
       SELECT 1 FROM question_options o WHERE o.question_id = NEW.id AND NOT EXISTS (
         SELECT 1 FROM question_evidence e WHERE e.question_id = o.question_id AND e.option_id = o.id
       )
     )
     OR EXISTS (
       SELECT 1 FROM question_evidence e JOIN sources s ON s.id = e.source_id
       WHERE e.question_id = NEW.id AND s.access_status <> 'full'
     ) THEN
    RAISE EXCEPTION 'Question and each option require verified evidence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM duplicate_reviews d
    WHERE NEW.id IN (first_question_id, second_question_id) AND d.outcome IN ('pending', 'needs_rewrite')
  ) THEN
    RAISE EXCEPTION 'Question has unresolved duplicate review';
  END IF;

  digest := question_digest(NEW.id);
  IF NOT EXISTS (
    SELECT 1 FROM question_reviews i JOIN question_reviews r USING (question_id)
    WHERE i.question_id = NEW.id AND i.phase = 'initial' AND r.phase = 'independent'
      AND i.reviewer <> r.reviewer AND i.outcome = 'approved' AND r.outcome = 'approved'
      AND i.reviewed_at <= r.reviewed_at AND i.content_sha256 = digest AND r.content_sha256 = digest
      AND i.emotion_only = NEW.emotion_only AND r.emotion_only = NEW.emotion_only
      AND ARRAY(SELECT unnest(i.independently_selected) ORDER BY 1) = correct_ids
      AND ARRAY(SELECT unnest(r.independently_selected) ORDER BY 1) = correct_ids
  ) THEN
    RAISE EXCEPTION 'Question needs two separate matching reviews of its current content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_publication_guard
  BEFORE INSERT OR UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION check_published_question();

CREATE FUNCTION lock_reviewed_question_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  FOR parent_status IN
    SELECT q.status FROM questions q
    WHERE (TG_OP <> 'INSERT' AND q.id = OLD.question_id OR TG_OP <> 'DELETE' AND q.id = NEW.question_id)
    ORDER BY q.id
    FOR UPDATE
  LOOP
    IF parent_status IN ('approved', 'published') THEN
      RAISE EXCEPTION 'Return the question to review before editing its reviewed parts';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER option_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_options
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();
CREATE TRIGGER answer_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_answers
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();
CREATE TRIGGER explanation_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_explanations
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();
CREATE TRIGGER evidence_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_evidence
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();
CREATE TRIGGER knowledge_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_knowledge_points
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();
CREATE TRIGGER question_review_lock BEFORE INSERT OR UPDATE OR DELETE ON question_reviews
  FOR EACH ROW EXECUTE FUNCTION lock_reviewed_question_parts();

CREATE TABLE content_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now()
);
