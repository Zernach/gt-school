import fc from 'fast-check';
import { scoreConfidence, signalsForConflict, type ConfidenceSignals } from '../../src/domain/confidence.js';
import type { ConflictType, DetectedConflict } from '../../src/domain/fixture-types.js';
import { buildConflict } from '../../src/domain/invariants.js';
import { candidateAction, canAutoApply, SENSITIVE_FIELDS } from '../../src/domain/policy.js';
import { transitionProposal, type ProposalDecision, type ProposalStatus } from '../../src/domain/proposal-state.js';
import { assertMicrocents, canReserve, reserve, settle } from '../../src/domain/spend.js';

const baseSignals: ConfidenceSignals = {
  hardIdAgreement: false,
  exactEmailAgreement: false,
  exactNameDobAgreement: false,
  agreeingFieldRatioBp: 0,
  disagreementRatioBp: 0,
  missingEvidence: false,
  sensitiveAction: false
};

function conflict(type: ConflictType): DetectedConflict {
  return buildConflict(type, ['student:test', 'crm:test'], ['app', 'crm'], ['grade'], { fixture: true });
}

describe('deterministic confidence policy', () => {
  it('returns the baseline score and policy version', () => {
    expect(scoreConfidence(baseSignals)).toEqual({ scoreBp: 500, score: 0.05, version: 'confidence-v1', signals: baseSignals });
  });

  it('adds hard ID agreement weight', () => {
    expect(scoreConfidence({ ...baseSignals, hardIdAgreement: true }).scoreBp).toBe(4000);
  });

  it('adds exact email agreement weight', () => {
    expect(scoreConfidence({ ...baseSignals, exactEmailAgreement: true }).scoreBp).toBe(3000);
  });

  it('adds exact name+DOB agreement weight', () => {
    expect(scoreConfidence({ ...baseSignals, exactNameDobAgreement: true }).scoreBp).toBe(2500);
  });

  it('adds the agreeing-field ratio contribution', () => {
    expect(scoreConfidence({ ...baseSignals, agreeingFieldRatioBp: 7500 }).scoreBp).toBe(1250);
  });

  it('subtracts the disagreement ratio contribution', () => {
    expect(scoreConfidence({ ...baseSignals, hardIdAgreement: true, disagreementRatioBp: 5000 }).scoreBp).toBe(3250);
  });

  it('subtracts missing-evidence penalty', () => {
    expect(scoreConfidence({ ...baseSignals, hardIdAgreement: true, missingEvidence: true }).scoreBp).toBe(2000);
  });

  it('subtracts sensitive-action penalty', () => {
    expect(scoreConfidence({ ...baseSignals, hardIdAgreement: true, sensitiveAction: true }).scoreBp).toBe(1000);
  });

  it('clamps a negative score to zero', () => {
    expect(scoreConfidence({ ...baseSignals, disagreementRatioBp: 10_000, missingEvidence: true, sensitiveAction: true }).scoreBp).toBe(0);
  });

  it('clamps a score above one to 10,000 basis points', () => {
    expect(scoreConfidence({ ...baseSignals, hardIdAgreement: true, exactEmailAgreement: true, exactNameDobAgreement: true, agreeingFieldRatioBp: 10_000 }).scoreBp).toBe(9500);
  });

  it('is deterministic for the same signals', () => {
    fc.assert(fc.property(
      fc.record({
        hardIdAgreement: fc.boolean(),
        exactEmailAgreement: fc.boolean(),
        exactNameDobAgreement: fc.boolean(),
        agreeingFieldRatioBp: fc.integer({ min: 0, max: 10_000 }),
        disagreementRatioBp: fc.integer({ min: 0, max: 10_000 }),
        missingEvidence: fc.boolean(),
        sensitiveAction: fc.boolean()
      }),
      (signals) => {
        expect(scoreConfidence(signals)).toEqual(scoreConfidence(structuredClone(signals)));
      }
    ), { numRuns: 500 });
  });

  it('always stays within [0,1]', () => {
    fc.assert(fc.property(
      fc.record({
        hardIdAgreement: fc.boolean(),
        exactEmailAgreement: fc.boolean(),
        exactNameDobAgreement: fc.boolean(),
        agreeingFieldRatioBp: fc.integer({ min: -100_000, max: 100_000 }),
        disagreementRatioBp: fc.integer({ min: -100_000, max: 100_000 }),
        missingEvidence: fc.boolean(),
        sensitiveAction: fc.boolean()
      }),
      (signals) => {
        const result = scoreConfidence(signals);
        expect(result.scoreBp).toBeGreaterThanOrEqual(0);
        expect(result.scoreBp).toBeLessThanOrEqual(10_000);
        expect(result.score).toBe(result.scoreBp / 10_000);
      }
    ), { numRuns: 500 });
  });

  it('lowers otherwise-equal evidence when it becomes sensitive', () => {
    const ordinary = scoreConfidence({ ...baseSignals, hardIdAgreement: true, exactEmailAgreement: true, agreeingFieldRatioBp: 8000 });
    const sensitive = scoreConfidence({ ...baseSignals, hardIdAgreement: true, exactEmailAgreement: true, agreeingFieldRatioBp: 8000, sensitiveAction: true });
    expect(sensitive.scoreBp).toBeLessThan(ordinary.scoreBp);
  });

  it('lowers otherwise-equal evidence when a source is missing', () => {
    const complete = scoreConfidence({ ...baseSignals, hardIdAgreement: true, exactEmailAgreement: true });
    const missing = scoreConfidence({ ...baseSignals, hardIdAgreement: true, exactEmailAgreement: true, missingEvidence: true });
    expect(missing.scoreBp).toBeLessThan(complete.scoreBp);
  });
});

describe('signalsForConflict', () => {
  it('detects student plus source evidence as a hard-ID signal', () => {
    expect(signalsForConflict(conflict('material_field_disagreement'), false).hardIdAgreement).toBe(true);
  });

  it('does not claim exact email agreement when email itself disagrees', () => {
    const value = buildConflict('cross_source_email_mismatch', ['student:test', 'crm:test'], ['app', 'crm'], ['email']);
    expect(signalsForConflict(value, false).exactEmailAgreement).toBe(false);
  });

  it('captures name+DOB evidence for C4', () => {
    const value = buildConflict('cross_source_email_mismatch', ['student:test', 'crm:test'], ['app', 'crm'], ['email']);
    expect(signalsForConflict(value, false).exactNameDobAgreement).toBe(true);
  });

  it.each(['payment_with_no_person', 'required_source_missing'] as const)('penalizes missing evidence for %s', (type) => {
    expect(signalsForConflict(conflict(type), false).missingEvidence).toBe(true);
  });

  it('copies the sensitive classification from the action gate', () => {
    expect(signalsForConflict(conflict('sensitive_field_only_fix'), true).sensitiveAction).toBe(true);
  });

  it('increases disagreement ratio with more fields but caps it', () => {
    const one = conflict('material_field_disagreement');
    const many = { ...one, disagreeing_fields: Array.from({ length: 20 }, (_, index) => `field-${index}`) };
    expect(signalsForConflict(one, false).disagreementRatioBp).toBe(2000);
    expect(signalsForConflict(many, false).disagreementRatioBp).toBe(10_000);
  });
});

describe('candidate action allowlist', () => {
  const cases: Array<[ConflictType, string, string, boolean]> = [
    ['paid_but_no_deal', 'link_or_create_deal_review', 'crm_deal_id', false],
    ['payment_with_no_person', 'link_payment_review', 'person_link', false],
    ['duplicate_by_email', 'merge_contact_review', 'student_id', true],
    ['cross_source_email_mismatch', 'resolve_identity_review', 'legal_first_name', true],
    ['required_source_missing', 'create_missing_link_review', 'source_presence', false],
    ['material_field_disagreement', 'select_authoritative_value_review', 'grade', false],
    ['enrolled_but_unpaid', 'review_enrollment_status', 'enrollment_status', true],
    ['dropped_sibling', 'restore_household_link_review', 'household_member_payment', false],
    ['stale_crm_pointer', 'repair_deal_pointer_review', 'crm_deal_id', false],
    ['merge_collapsed_record', 'split_contact_review', 'student_id', true],
    ['duplicate_payment', 'deduplicate_payment_review', 'payer_email', true],
    ['wrong_amount_payment', 'review_payment_amount', 'payment_status', true],
    ['refund_not_reflected', 'review_refund_projection', 'payment_status', true],
    ['sensitive_field_only_fix', 'review_billing_owner', 'billing_owner_email', true]
  ];

  it.each(cases)('maps %s to allowlisted %s on %s', (type, kind, targetField, sensitive) => {
    const action = candidateAction(conflict(type));
    expect(action.kind).toBe(kind);
    expect(action.targetField).toBe(targetField);
    expect(action.policyVersion).toBe('actions-v1');
    expect(action.proposedValue).toContain('review:conflict_');
    expect(action.sensitiveFields.length > 0).toBe(sensitive);
  });

  it('generates the same fingerprint for the same stable conflict', () => {
    const first = candidateAction(conflict('paid_but_no_deal'));
    const second = candidateAction(conflict('paid_but_no_deal'));
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('does not include a generation in the action fingerprint', () => {
    const original = conflict('material_field_disagreement');
    const nextGeneration = { ...original, evidence: { ...original.evidence, generation: 3 } };
    expect(candidateAction(nextGeneration).fingerprint).toBe(candidateAction(original).fingerprint);
  });

  it('separates fingerprints for different conflict keys', () => {
    expect(candidateAction(conflict('paid_but_no_deal')).fingerprint).not.toBe(candidateAction(conflict('stale_crm_pointer')).fingerprint);
  });

  it('classifies every normative sensitive field', () => {
    expect([...SENSITIVE_FIELDS]).toEqual(expect.arrayContaining([
      'legal_first_name',
      'legal_last_name',
      'date_of_birth',
      'government_id',
      'student_id',
      'payer_email',
      'billing_owner_email',
      'enrollment_status',
      'deal_status',
      'payment_status',
      'marketing_consent',
      'communication_opt_out',
      'privacy_state'
    ]));
  });
});

describe('auto-apply gate remains separate from Core', () => {
  const ordinary = candidateAction(conflict('paid_but_no_deal'));
  const sensitive = candidateAction(conflict('sensitive_field_only_fix'));

  it('requires confidence at or above 0.95', () => {
    expect(canAutoApply(ordinary, 9499, true, true)).toBe(false);
    expect(canAutoApply(ordinary, 9500, true, true)).toBe(true);
  });

  it('requires reviewer approval', () => {
    expect(canAutoApply(ordinary, 10_000, false, true)).toBe(false);
  });

  it('requires a known rollback path', () => {
    expect(canAutoApply(ordinary, 10_000, true, false)).toBe(false);
  });

  it('hard-denies sensitive changes at perfect confidence', () => {
    expect(canAutoApply(sensitive, 10_000, true, true)).toBe(false);
  });

  it.each([
    [0, false, false],
    [9500, false, false],
    [9500, true, false],
    [10_000, false, true]
  ])('does not pass partial gate confidence=%d approved=%s rollback=%s', (confidence, approved, rollback) => {
    expect(canAutoApply(ordinary, confidence, approved, rollback)).toBe(false);
  });
});

describe('integer spend arithmetic', () => {
  it.each([0, 1, 10, Number.MAX_SAFE_INTEGER])('converts safe number %d to bigint', (value) => {
    expect(assertMicrocents(value)).toBe(BigInt(value));
  });

  it.each([0n, 1n, 999_999_999_999n])('accepts bigint %s', (value) => {
    expect(assertMicrocents(value)).toBe(value);
  });

  for (const [label, value] of [
    ['negative number', -1],
    ['negative bigint', -1n],
    ['fraction', 1.5],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['numeric string', '10'],
    ['null', null],
    ['undefined', undefined]
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(() => assertMicrocents(value)).toThrow('microcents_invalid');
    });
  }

  it('uses the custom label in validation failures', () => {
    expect(() => assertMicrocents(-1, 'daily_cap')).toThrow('daily_cap_invalid');
  });

  it('allows a reservation exactly at the cap', () => {
    expect(canReserve({ cap: 100n, reserved: 40n, actual: 20n }, 60n)).toBe(true);
    expect(reserve({ cap: 100n, reserved: 40n, actual: 20n }, 60n)).toEqual({ cap: 100n, reserved: 100n, actual: 20n });
  });

  it('denies a reservation one unit over cap', () => {
    expect(canReserve({ cap: 100n, reserved: 40n, actual: 20n }, 61n)).toBe(false);
    expect(() => reserve({ cap: 100n, reserved: 40n, actual: 20n }, 61n)).toThrow('spend_cap_reached');
  });

  it('rejects a negative estimate', () => {
    expect(() => canReserve({ cap: 100n, reserved: 0n, actual: 0n }, -1n)).toThrow('estimate_invalid');
  });

  it('settles and releases only unused reservation', () => {
    expect(settle({ cap: 100n, reserved: 80n, actual: 0n }, 30n)).toEqual({ cap: 100n, reserved: 80n, actual: 30n, released: 50n });
  });

  it('allows worst-case settlement', () => {
    expect(settle({ cap: 100n, reserved: 80n, actual: 0n }, 80n)).toEqual({ cap: 100n, reserved: 80n, actual: 80n, released: 0n });
  });

  it.each([-1n, 81n])('rejects invalid actual cost %s', (value) => {
    expect(() => settle({ cap: 100n, reserved: 80n, actual: 0n }, value)).toThrow('actual_cost_invalid');
  });

  it('never permits cumulative property-based reservations above cap', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 100 }),
      (estimates) => {
        let state = { cap: 500n, reserved: 0n, actual: 0n };
        for (const estimate of estimates.map(BigInt)) {
          if (canReserve(state, estimate)) state = reserve(state, estimate);
          expect(state.reserved).toBeLessThanOrEqual(state.cap);
        }
      }
    ), { numRuns: 500 });
  });
});

describe('proposal state transitions', () => {
  it.each([
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['hold', 'held']
  ] as Array<[ProposalDecision, ProposalStatus]>)('maps pending + %s to %s', (decision, expected) => {
    expect(transitionProposal('pending', decision)).toBe(expected);
  });

  it.each(['approved', 'rejected', 'held', 'superseded'] as ProposalStatus[])('rejects a second decision from terminal status %s', (status) => {
    expect(() => transitionProposal(status, 'approve')).toThrow('proposal_transition_illegal');
  });

  it('does not mutate input status', () => {
    const status: ProposalStatus = 'pending';
    transitionProposal(status, 'hold');
    expect(status).toBe('pending');
  });
});
