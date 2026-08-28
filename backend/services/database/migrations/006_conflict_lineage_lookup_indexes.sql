-- Conflict detail resolves a small set of source IDs from the active snapshot.
-- Keep that lookup selective even when prior snapshots are retained for audit.
CREATE INDEX source_records_tenant_source_lookup_idx
  ON source_records (tenant_id, source_id, snapshot_id, id);
