import type { ConflictType, DetectedConflict } from './fixture-types.js';
import { stableKey } from './stable.js';

export const ACTION_POLICY_VERSION = 'actions-v1';
export const SENSITIVE_FIELDS = new Set([
  'legal_first_name', 'legal_last_name', 'date_of_birth', 'government_id', 'student_id',
  'payer_email', 'billing_owner_email', 'enrollment_status', 'deal_status', 'payment_status',
  'marketing_consent', 'communication_opt_out', 'privacy_state'
]);

export const AUTO_APPLY_CASE_TYPES = new Set<ConflictType>([
  'paid_but_no_deal',
  'stale_crm_pointer',
  'dropped_sibling',
  'material_field_disagreement'
]);

const ACTION_BY_TYPE: Record<ConflictType, { kind: string; targetField: string }> = {
  paid_but_no_deal: { kind: 'link_or_create_deal_review', targetField: 'crm_deal_id' },
  payment_with_no_person: { kind: 'link_payment_review', targetField: 'person_link' },
  duplicate_by_email: { kind: 'merge_contact_review', targetField: 'student_id' },
  cross_source_email_mismatch: { kind: 'resolve_identity_review', targetField: 'legal_first_name' },
  required_source_missing: { kind: 'create_missing_link_review', targetField: 'source_presence' },
  material_field_disagreement: { kind: 'select_authoritative_value_review', targetField: 'grade' },
  enrolled_but_unpaid: { kind: 'review_enrollment_status', targetField: 'enrollment_status' },
  dropped_sibling: { kind: 'restore_household_link_review', targetField: 'household_member_payment' },
  stale_crm_pointer: { kind: 'repair_deal_pointer_review', targetField: 'crm_deal_id' },
  merge_collapsed_record: { kind: 'split_contact_review', targetField: 'student_id' },
  duplicate_payment: { kind: 'deduplicate_payment_review', targetField: 'payer_email' },
  wrong_amount_payment: { kind: 'review_payment_amount', targetField: 'payment_status' },
  refund_not_reflected: { kind: 'review_refund_projection', targetField: 'payment_status' },
  sensitive_field_only_fix: { kind: 'review_billing_owner', targetField: 'billing_owner_email' }
};

export interface CandidateAction {
  kind: string;
  conflictType: ConflictType;
  targetField: string;
  proposedValue: string;
  policyVersion: typeof ACTION_POLICY_VERSION;
  sensitiveFields: string[];
  fingerprint: string;
}

export interface AutoApplyGate {
  action: CandidateAction;
  confidenceBp: number;
  evidenceComplete: boolean;
  rollbackAvailable: boolean;
}

export function candidateAction(conflict: DetectedConflict): CandidateAction {
  const policy = ACTION_BY_TYPE[conflict.type];
  const proposedValue = `review:${conflict.conflict_key}`;
  const sensitiveFields = SENSITIVE_FIELDS.has(policy.targetField) ? [policy.targetField] : [];
  const fingerprint = stableKey('action', {
    conflictKey: conflict.conflict_key,
    kind: policy.kind,
    targetField: policy.targetField,
    proposedValue,
    policyVersion: ACTION_POLICY_VERSION
  });
  return {
    ...policy,
    conflictType: conflict.type,
    proposedValue,
    policyVersion: ACTION_POLICY_VERSION,
    sensitiveFields,
    fingerprint
  };
}

export function approvedAutoApplyCase(conflictType: ConflictType): boolean {
  return AUTO_APPLY_CASE_TYPES.has(conflictType);
}

export function canAutoApply(action: CandidateAction, confidenceBp: number, evidenceComplete: boolean, rollbackAvailable: boolean): boolean {
  return evaluateAutoApply({ action, confidenceBp, evidenceComplete, rollbackAvailable }).eligible;
}

export function evaluateAutoApply(gate: AutoApplyGate): { eligible: boolean; denials: string[] } {
  const denials: string[] = [];
  if (!approvedAutoApplyCase(gate.action.conflictType)) denials.push('case_type_not_approved');
  if (gate.action.sensitiveFields.length > 0) denials.push('sensitive_field');
  if (gate.confidenceBp < 9500) denials.push('confidence_below_095');
  if (!gate.evidenceComplete) denials.push('evidence_incomplete');
  if (!gate.rollbackAvailable) denials.push('rollback_unavailable');
  return { eligible: denials.length === 0, denials };
}
