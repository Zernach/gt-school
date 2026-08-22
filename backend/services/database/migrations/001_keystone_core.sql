CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS source_app;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  client_key_hash text NOT NULL UNIQUE,
  reviewer_key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_app.students (
  seed integer NOT NULL CHECK (seed >= 0),
  generation integer NOT NULL CHECK (generation > 0),
  source_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (seed, generation, source_id)
);

CREATE TABLE IF NOT EXISTS source_app.enrollments (
  seed integer NOT NULL CHECK (seed >= 0),
  generation integer NOT NULL CHECK (generation > 0),
  source_id text NOT NULL,
  student_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (seed, generation, source_id)
);

CREATE TABLE IF NOT EXISTS source_app.fixture_manifests (
  seed integer PRIMARY KEY CHECK (seed >= 0),
  manifest jsonb NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  requested_generation integer NOT NULL CHECK (requested_generation > 0),
  status text NOT NULL CHECK (status IN ('queued','running','complete','partial','failed')),
  source_availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS source_runs (
  id uuid PRIMARY KEY,
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_kind text NOT NULL CHECK (source_kind IN ('crm','app','payments')),
  generation integer NOT NULL CHECK (generation > 0),
  status text NOT NULL CHECK (status IN ('running','complete','partial','failed')),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  latency_ms integer CHECK (latency_ms >= 0),
  error_code text,
  error_detail text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (sync_run_id, source_kind)
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id uuid PRIMARY KEY,
  source_run_id uuid NOT NULL REFERENCES source_runs(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_kind text NOT NULL CHECK (source_kind IN ('crm','app','payments')),
  generation integer NOT NULL CHECK (generation > 0),
  adapter_version text NOT NULL,
  schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('staging','complete','partial','failed')),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, source_kind, generation, source_run_id)
);

CREATE TABLE IF NOT EXISTS active_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_kind text NOT NULL CHECK (source_kind IN ('crm','app','payments')),
  snapshot_id uuid NOT NULL REFERENCES source_snapshots(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_kind)
);

CREATE TABLE IF NOT EXISTS source_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  snapshot_id uuid NOT NULL REFERENCES source_snapshots(id),
  source_kind text NOT NULL CHECK (source_kind IN ('crm','app','payments')),
  entity_kind text NOT NULL,
  source_id text NOT NULL,
  occurrence integer NOT NULL DEFAULT 1 CHECK (occurrence > 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, entity_kind, source_id, occurrence)
);

CREATE TABLE IF NOT EXISTS field_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_record_id bigint NOT NULL REFERENCES source_records(id),
  field_path text NOT NULL,
  raw_value jsonb,
  normalized_value jsonb,
  normalization_version text NOT NULL,
  transformation_trace text[] NOT NULL DEFAULT '{}',
  source_observed_at timestamptz NOT NULL,
  UNIQUE (source_record_id, field_path)
);

CREATE TABLE IF NOT EXISTS canonical_entities (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_kind text NOT NULL,
  display_name text NOT NULL,
  resolution_status text NOT NULL CHECK (resolution_status IN ('linked','ambiguous','unlinked')),
  match_method text NOT NULL,
  match_score_bp integer NOT NULL CHECK (match_score_bp BETWEEN 0 AND 10000),
  summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS entity_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  canonical_entity_id text NOT NULL,
  source_record_id bigint NOT NULL REFERENCES source_records(id),
  match_method text NOT NULL,
  match_score_bp integer NOT NULL CHECK (match_score_bp BETWEEN 0 AND 10000),
  evidence jsonb NOT NULL,
  rule_version text NOT NULL,
  FOREIGN KEY (tenant_id, canonical_entity_id) REFERENCES canonical_entities(tenant_id, id),
  UNIQUE (tenant_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS households (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  guardian_email_hash text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS household_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  household_id text NOT NULL,
  canonical_entity_id text NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY (tenant_id, household_id, canonical_entity_id),
  FOREIGN KEY (tenant_id, household_id) REFERENCES households(tenant_id, id),
  FOREIGN KEY (tenant_id, canonical_entity_id) REFERENCES canonical_entities(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS invariant_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id),
  rule_set_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','complete','partial','failed')),
  source_availability jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS invariant_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invariant_run_id uuid NOT NULL REFERENCES invariant_runs(id),
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  entity_ref text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass','fail','unchecked','error')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_key text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invariant_run_id, rule_id, entity_ref, conflict_key)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conflict_key text NOT NULL,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  type text NOT NULL,
  entity_refs text[] NOT NULL,
  sources_involved text[] NOT NULL,
  disagreeing_fields text[] NOT NULL,
  expected_verdict text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','unchecked','oscillation_hold')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  latest_generation integer NOT NULL,
  oscillation_count integer NOT NULL DEFAULT 0 CHECK (oscillation_count >= 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, conflict_key)
);

CREATE TABLE IF NOT EXISTS proposals (
  id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conflict_id text NOT NULL,
  action_fingerprint text NOT NULL,
  action jsonb NOT NULL,
  evidence jsonb NOT NULL,
  confidence_bp integer NOT NULL CHECK (confidence_bp BETWEEN 0 AND 10000),
  confidence_signals jsonb NOT NULL,
  sensitive_fields text[] NOT NULL DEFAULT '{}',
  sensitive_hold boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','held','superseded')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  estimated_cost_microcents bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_microcents >= 0),
  actual_cost_microcents bigint NOT NULL DEFAULT 0 CHECK (actual_cost_microcents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conflict_id) REFERENCES conflicts(tenant_id, id),
  UNIQUE (tenant_id, action_fingerprint)
);

CREATE TABLE IF NOT EXISTS proposal_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  proposal_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','hold')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  actor text NOT NULL,
  proposal_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES proposals(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS spend_buckets (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  spend_day date NOT NULL,
  cap_microcents bigint NOT NULL CHECK (cap_microcents >= 0),
  reserved_microcents bigint NOT NULL DEFAULT 0 CHECK (reserved_microcents >= 0),
  actual_microcents bigint NOT NULL DEFAULT 0 CHECK (actual_microcents >= 0),
  released_microcents bigint NOT NULL DEFAULT 0 CHECK (released_microcents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, spend_day),
  CHECK (actual_microcents <= reserved_microcents),
  CHECK (reserved_microcents <= cap_microcents)
);

CREATE TABLE IF NOT EXISTS spend_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_id uuid,
  cap_microcents bigint NOT NULL CHECK (cap_microcents >= 0),
  reserved_microcents bigint NOT NULL DEFAULT 0 CHECK (reserved_microcents >= 0),
  actual_microcents bigint NOT NULL DEFAULT 0 CHECK (actual_microcents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actual_microcents <= reserved_microcents),
  CHECK (reserved_microcents <= cap_microcents)
);

CREATE TABLE IF NOT EXISTS spend_reservations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  spend_run_id uuid NOT NULL REFERENCES spend_runs(id),
  action_fingerprint text NOT NULL,
  maximum_microcents bigint NOT NULL CHECK (maximum_microcents >= 0),
  actual_microcents bigint CHECK (actual_microcents >= 0 AND actual_microcents <= maximum_microcents),
  status text NOT NULL CHECK (status IN ('reserved','settled','charged_worst_case')),
  provider_call_started_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_fingerprint)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_type text NOT NULL CHECK (job_type IN ('sync','reconcile')),
  idempotency_key text NOT NULL,
  request_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued','published','running','retry_wait','complete','failed','halted','duplicate')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  stream_id text,
  last_error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tenant_id, job_type, idempotency_key)
);

ALTER TABLE spend_runs
  DROP CONSTRAINT IF EXISTS spend_runs_job_id_fkey;
ALTER TABLE spend_runs
  ADD CONSTRAINT spend_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);

CREATE TABLE IF NOT EXISTS fixture_rejections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_kind text NOT NULL,
  generation integer NOT NULL,
  rejection_key text NOT NULL,
  error_code text NOT NULL,
  detail text NOT NULL,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_kind, generation, rejection_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL,
  actor text NOT NULL,
  request_id text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_records_scope_lookup_idx ON source_records (tenant_id, snapshot_id, entity_kind, source_id);
CREATE INDEX IF NOT EXISTS source_records_payload_gin_idx ON source_records USING gin (payload);
CREATE INDEX IF NOT EXISTS field_observations_record_idx ON field_observations (tenant_id, source_record_id, field_path);
CREATE INDEX IF NOT EXISTS canonical_entities_scope_idx ON canonical_entities (tenant_id, entity_kind, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS invariant_results_verdict_idx ON invariant_results (tenant_id, verdict, rule_id, id);
CREATE INDEX IF NOT EXISTS conflicts_dashboard_idx ON conflicts (tenant_id, status, type, last_seen_at DESC, id);
CREATE INDEX IF NOT EXISTS conflicts_sources_gin_idx ON conflicts USING gin (sources_involved);
CREATE INDEX IF NOT EXISTS proposals_queue_idx ON proposals (tenant_id, status, confidence_bp DESC, created_at DESC, id);
CREATE INDEX IF NOT EXISTS jobs_dispatch_idx ON jobs (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS audit_events_object_idx ON audit_events (tenant_id, object_type, object_id, created_at, id);

COMMENT ON SCHEMA source_app IS 'Synthetic app-Postgres fixture source. Runtime role is SELECT-only.';
COMMENT ON TABLE source_records IS 'Immutable source mirror; application routes expose no update or delete path.';
COMMENT ON TABLE audit_events IS 'Append-only audit history; no API update or delete route exists.';
