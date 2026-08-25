import type { DetectedConflict } from './fixture-types.js';

export const CONFIDENCE_POLICY_VERSION = 'confidence-v2';

export interface ConfidenceSignals {
  hardIdAgreement: boolean;
  exactEmailAgreement: boolean;
  exactNameDobAgreement: boolean;
  uniqueCanonicalMatch: boolean;
  agreeingFieldRatioBp: number;
  disagreementRatioBp: number;
  missingEvidence: boolean;
  evidenceComplete: boolean;
  sensitiveAction: boolean;
}

export interface ConfidenceResult {
  scoreBp: number;
  score: number;
  version: typeof CONFIDENCE_POLICY_VERSION;
  signals: ConfidenceSignals;
}

export function scoreConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const raw = 500
    + (signals.hardIdAgreement ? 3500 : 0)
    + (signals.exactEmailAgreement ? 2500 : 0)
    + (signals.exactNameDobAgreement ? 2000 : 0)
    + (signals.uniqueCanonicalMatch ? 2000 : 0)
    + Math.round(signals.agreeingFieldRatioBp * 0.1)
    - Math.round(signals.disagreementRatioBp * 0.15)
    - (signals.missingEvidence ? 2000 : 0)
    + (signals.evidenceComplete ? 1000 : 0)
    - (signals.sensitiveAction ? 3000 : 0);
  const scoreBp = Math.max(0, Math.min(10_000, raw));
  return { scoreBp, score: scoreBp / 10_000, version: CONFIDENCE_POLICY_VERSION, signals };
}

export function signalsForConflict(conflict: DetectedConflict, sensitiveAction: boolean): ConfidenceSignals {
  const hasStudent = conflict.entity_refs.some((ref) => ref.startsWith('student:'));
  const hasEmail = conflict.disagreeing_fields.some((field) => field.includes('email'));
  const missingEvidence = conflict.type === 'payment_with_no_person' || conflict.type === 'required_source_missing';
  return {
    hardIdAgreement: hasStudent && conflict.entity_refs.length > 1,
    exactEmailAgreement: !hasEmail && conflict.sources_involved.length > 1,
    exactNameDobAgreement: conflict.type === 'cross_source_email_mismatch',
    uniqueCanonicalMatch: hasStudent && conflict.entity_refs.length > 1 && conflict.sources_involved.length >= 2,
    agreeingFieldRatioBp: conflict.sources_involved.length >= 2 ? 7500 : 5000,
    disagreementRatioBp: Math.min(10_000, conflict.disagreeing_fields.length * 2000),
    missingEvidence,
    evidenceComplete: !missingEvidence && Object.keys(conflict.evidence).length > 0 && conflict.entity_refs.length > 0,
    sensitiveAction
  };
}
