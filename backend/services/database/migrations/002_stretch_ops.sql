CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check CHECK (job_type IN ('sync','reconcile','stretch'));

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check CHECK (status IN ('pending','approved','rejected','held','superseded','applied','rolled_back'));

CREATE TABLE IF NOT EXISTS proposal_applications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  proposal_id text NOT NULL,
  conflict_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','rolled_back')),
  rollback_snapshot jsonb NOT NULL,
  actor text NOT NULL,
  request_id text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES proposals(tenant_id, id),
  FOREIGN KEY (tenant_id, conflict_id) REFERENCES conflicts(tenant_id, id),
  UNIQUE (tenant_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS grouping_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  model text NOT NULL CHECK (model = 'conflict-pattern-hash-v1'),
  dimensions integer NOT NULL CHECK (dimensions = 64),
  distance_metric text NOT NULL CHECK (distance_metric = 'cosine'),
  member_count integer NOT NULL CHECK (member_count >= 0),
  group_count integer NOT NULL CHECK (group_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_embeddings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conflict_id text NOT NULL,
  grouping_run_id uuid NOT NULL REFERENCES grouping_runs(id),
  model text NOT NULL CHECK (model = 'conflict-pattern-hash-v1'),
  dimensions integer NOT NULL CHECK (dimensions = 64),
  embedding vector(64) NOT NULL,
  feature_text text NOT NULL,
  feature_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conflict_id) REFERENCES conflicts(tenant_id, id),
  UNIQUE (tenant_id, conflict_id)
);

CREATE TABLE IF NOT EXISTS incident_groups (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grouping_run_id uuid NOT NULL REFERENCES grouping_runs(id),
  label text NOT NULL,
  member_count integer NOT NULL CHECK (member_count > 0),
  centroid vector(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS incident_group_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grouping_run_id uuid NOT NULL REFERENCES grouping_runs(id),
  group_id text NOT NULL,
  conflict_id text NOT NULL,
  distance_bp integer NOT NULL CHECK (distance_bp >= 0 AND distance_bp <= 20000),
  PRIMARY KEY (tenant_id, grouping_run_id, conflict_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES incident_groups(tenant_id, id),
  FOREIGN KEY (tenant_id, conflict_id) REFERENCES conflicts(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS extracted_tickets (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  message_id text NOT NULL,
  conflict_id text,
  student_ref text,
  family_ref text,
  system text NOT NULL CHECK (system IN ('crm','app','payments','unknown')),
  record_id text,
  issue_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','pending','resolved')),
  owner text NOT NULL,
  requested_action text NOT NULL,
  resolution text,
  opened_at timestamptz,
  resolved_at timestamptz,
  extraction_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, message_id),
  FOREIGN KEY (tenant_id, conflict_id) REFERENCES conflicts(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS log_retention_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  retention_days integer NOT NULL CHECK (retention_days > 0),
  alerts_deleted integer NOT NULL CHECK (alerts_deleted >= 0),
  cutoff_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_embeddings_hnsw_idx
  ON incident_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS incident_groups_run_idx ON incident_groups (tenant_id, grouping_run_id, member_count DESC, id);
CREATE INDEX IF NOT EXISTS incident_group_members_group_idx ON incident_group_members (tenant_id, group_id, conflict_id);
CREATE INDEX IF NOT EXISTS extracted_tickets_issue_idx ON extracted_tickets (tenant_id, issue_type, status, opened_at DESC, id);
CREATE INDEX IF NOT EXISTS extracted_tickets_student_idx ON extracted_tickets (tenant_id, student_ref, id);
CREATE INDEX IF NOT EXISTS proposal_applications_conflict_idx ON proposal_applications (tenant_id, conflict_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS alert_events_retention_idx ON alert_events (created_at, id);

COMMENT ON TABLE incident_embeddings IS 'Deterministic conflict-pattern-hash-v1 embeddings, 64-d cosine/HNSW; rebuilt per grouping run; deleted with the next refresh.';
COMMENT ON TABLE extracted_tickets IS 'Structured support-ticket fields extracted from synthetic messages; joinable to students, households, and conflicts.';
COMMENT ON TABLE proposal_applications IS 'Keystone-internal auto-apply ledger with rollback snapshots; never writes a source system.';
