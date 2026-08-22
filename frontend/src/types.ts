export interface SourceStatus {
  source_kind: 'crm' | 'app' | 'payments';
  activated_at: string;
  generation: number;
  accepted_count: number;
  rejected_count: number;
  status: 'complete' | 'partial' | 'failed';
}

export interface OverviewData {
  sources: SourceStatus[];
  conflicts: { active: string; resolved: string; oscillation_hold: string };
  proposals: Array<{ status: string; count: number }>;
  invariant: { status: string; summary: { pass?: number; fail?: number; unchecked?: number; error?: number }; source_availability: Record<string, string>; completed_at: string } | null;
  spend: { cap_microcents: string; reserved_microcents: string; actual_microcents: string; released_microcents: string };
  latestRun: { id: string; status: string; requested_generation: number; source_availability: Record<string, string>; completed_at: string | null } | null;
}

export interface ConflictRow {
  id: string;
  type: string;
  entity_refs: string[];
  sources_involved: string[];
  disagreeing_fields: string[];
  status: string;
  last_seen_at: string;
  latest_generation: number;
  oscillation_count: number;
  proposal_id: string | null;
  proposal_status: string | null;
  confidence_bp: number | null;
  sensitive_hold: boolean | null;
}

export interface ConflictList {
  items: ConflictRow[];
  nextCursor: string | null;
}

export interface Proposal {
  id: string;
  conflict_id: string;
  conflict_type: string;
  entity_refs: string[];
  sources_involved: string[];
  disagreeing_fields: string[];
  action: { kind: string; targetField: string; proposedValue: string; policyVersion: string };
  evidence: Record<string, unknown>;
  confidence_bp: number;
  confidence_signals: Record<string, unknown>;
  sensitive_fields: string[];
  sensitive_hold: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'held' | 'superseded';
  version: number;
  estimated_cost_microcents: string;
  actual_cost_microcents: string;
  created_at: string;
}

export interface LineageRow {
  source_kind: string;
  entity_kind: string;
  source_id: string;
  field_path: string;
  raw_value: unknown;
  normalized_value: unknown;
  normalization_version: string;
  transformation_trace: string[];
  source_observed_at: string;
  ingested_at: string;
}

export interface AuditRow {
  event_type: string;
  actor: string;
  object_type: string;
  object_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ConflictDetail extends ConflictRow {
  rule_id: string;
  rule_version: string;
  expected_verdict: string;
  evidence: Record<string, unknown>;
  proposal: Proposal | null;
  lineage: LineageRow[];
  audit: AuditRow[];
}

export interface ConflictFilters {
  type: string;
  source: string;
  status: string;
  proposalStatus: string;
  minimumConfidence: string;
  from: string;
}
