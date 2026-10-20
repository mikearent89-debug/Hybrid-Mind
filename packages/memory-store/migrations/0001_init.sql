-- Memory store, schema v1 (MEMORY-SPEC section 4). One database holds the log, the projections,
-- the chunks and the claim graph, so one ID space and one access policy cover all of it.

CREATE EXTENSION IF NOT EXISTS vector;

-- The only table anything writes to. No UPDATE or DELETE, ever: the trigger below enforces it.
CREATE TABLE event_log (
  position        bigserial PRIMARY KEY,
  recorded_at     timestamptz NOT NULL,
  effective_at    timestamptz NOT NULL,
  actor_id        text        NOT NULL,
  correlation_id  text,
  event_type      text        NOT NULL,
  event           jsonb       NOT NULL
);

CREATE INDEX event_log_recorded_at_idx ON event_log (recorded_at);
CREATE INDEX event_log_correlation_idx ON event_log (correlation_id);
CREATE INDEX event_log_event_type_idx ON event_log (event_type);

CREATE FUNCTION event_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_log is append-only; append a superseding event instead';
END;
$$;

CREATE TRIGGER event_log_no_update
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW EXECUTE FUNCTION event_log_is_append_only();

CREATE TRIGGER event_log_no_truncate
  BEFORE TRUNCATE ON event_log
  EXECUTE FUNCTION event_log_is_append_only();

-- Current state of every record, projected from the log. Rewritten by the projector only; the
-- common fields are columns so access, review and as-of filters never parse JSON.
CREATE TABLE memory_record (
  record_type     text        NOT NULL,
  id              text        NOT NULL,
  record_version  integer     NOT NULL,
  access_scope    text        NOT NULL CHECK (access_scope IN ('standard', 'restricted')),
  evidence_class  text        NOT NULL,
  review_state    text        NOT NULL,
  effective_from  timestamptz,
  effective_to    timestamptz,
  data            jsonb       NOT NULL,
  projected_from  bigint      NOT NULL REFERENCES event_log (position),
  PRIMARY KEY (record_type, id)
);

CREATE INDEX memory_record_scope_idx ON memory_record (record_type, access_scope, review_state);
CREATE INDEX memory_record_data_idx ON memory_record USING gin (data jsonb_path_ops);

-- Claims as bitemporal edges for graph-neighborhood queries (recursive CTEs over this table).
CREATE TABLE edge (
  claim_id        text        PRIMARY KEY,
  from_id         text        NOT NULL,
  relation        text        NOT NULL,
  to_id           text,
  to_value        text,
  to_unit         text,
  valid_from      timestamptz,
  valid_to        timestamptz,
  invalidated_at  timestamptz,
  access_scope    text        NOT NULL,
  evidence_class  text        NOT NULL,
  review_state    text        NOT NULL,
  projected_from  bigint      NOT NULL REFERENCES event_log (position),
  CHECK ((to_id IS NULL) <> (to_value IS NULL))
);

CREATE INDEX edge_from_idx ON edge (from_id, relation);
CREATE INDEX edge_to_idx ON edge (to_id, relation);

-- Contextual chunks of a revision, for lexical and vector retrieval. Originals stay in the object
-- store under their content hash; a chunk only ever points back into an immutable revision.
CREATE TABLE chunk (
  id              bigserial   PRIMARY KEY,
  revision_id     text        NOT NULL,
  episode_id      text        NOT NULL,
  chunk_index     integer     NOT NULL,
  text            text        NOT NULL,
  context_prefix  text        NOT NULL,
  locator         jsonb       NOT NULL,
  embedding       vector,
  embedding_model text        NOT NULL,
  tsv             tsvector    GENERATED ALWAYS AS (to_tsvector('english', context_prefix || ' ' || text)) STORED,
  UNIQUE (revision_id, chunk_index)
);

CREATE INDEX chunk_tsv_idx ON chunk USING gin (tsv);
CREATE INDEX chunk_revision_idx ON chunk (revision_id);
