CREATE INDEX IF NOT EXISTS conflicts_dashboard_order_idx
  ON conflicts (tenant_id, last_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS proposals_conflict_recent_idx
  ON proposals (tenant_id, conflict_id, created_at DESC)
  INCLUDE (id, status, confidence_bp, sensitive_hold);
