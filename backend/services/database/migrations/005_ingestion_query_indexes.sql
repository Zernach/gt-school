-- Keep ingestion write amplification proportional to durable evidence. The
-- unique source-record/field-path key already supports targeted lineage reads.
DROP INDEX IF EXISTS field_observations_record_idx;

-- The API resolves active records by snapshot and source ID; entity_kind is a
-- returned attribute, not a lookup prerequisite.
DROP INDEX IF EXISTS source_records_scope_lookup_idx;
CREATE INDEX source_records_scope_lookup_idx
  ON source_records (tenant_id, snapshot_id, source_id, entity_kind, id);

-- Canonical lineage starts from a tenant-scoped entity and then joins the
-- immutable field-observation unique key by source_record_id.
CREATE INDEX entity_links_canonical_lookup_idx
  ON entity_links (tenant_id, canonical_entity_id, source_record_id);

-- Overview reads only failed rows from one invariant run. Do not index every
-- passing row by tenant and verdict when the run ID is the owning scope.
DROP INDEX IF EXISTS invariant_results_verdict_idx;
CREATE INDEX invariant_results_fail_run_idx
  ON invariant_results (invariant_run_id, conflict_key)
  WHERE verdict = 'fail';
