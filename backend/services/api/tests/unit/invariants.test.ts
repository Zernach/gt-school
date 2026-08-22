import type { ConflictType, FixtureSet } from '../../src/domain/fixture-types.js';
import { buildConflict, evaluateInvariants, RULE_DEPENDENCIES, RULE_SET_VERSION } from '../../src/domain/invariants.js';
import { cloneFixture, cleanFixture, makeContact, makePayment, makeStudent, siblingFixture } from '../helpers/fixtures.js';

function conflictTypes(fixtures: FixtureSet): ConflictType[] {
  return evaluateInvariants(fixtures).conflicts.map(({ type }) => type);
}

function expectOnly(fixtures: FixtureSet, type: ConflictType, count = 1): void {
  const evaluation = evaluateInvariants(fixtures);
  expect(evaluation.uncheckedRules).toEqual([]);
  expect(evaluation.conflicts).toHaveLength(count);
  expect(evaluation.conflicts.every((conflict) => conflict.type === type)).toBe(true);
  expect(evaluation.conflicts.map(({ conflict_key }) => new Set(evaluation.conflicts.map(({ conflict_key: key }) => key)).has(conflict_key))).not.toContain(false);
}

describe('invariant registry contract', () => {
  it('uses the committed version', () => {
    expect(RULE_SET_VERSION).toBe('invariants-v1');
  });

  it('declares dependencies for every C1-C14 type', () => {
    expect(Object.keys(RULE_DEPENDENCIES)).toHaveLength(14);
    expect(Object.values(RULE_DEPENDENCIES).every((dependencies) => dependencies.length > 0)).toBe(true);
  });

  it('builds a stable conflict independent of input ordering', () => {
    const first = buildConflict('material_field_disagreement', ['student:b', 'crm:a'], ['crm', 'app', 'crm'], ['grade', 'grade'], { example: true });
    const second = buildConflict('material_field_disagreement', ['crm:a', 'student:b'], ['app', 'crm'], ['grade'], { differentNarrative: true });
    expect(first.conflict_key).toBe(second.conflict_key);
    expect(first.entity_refs).toEqual(['crm:a', 'student:b']);
    expect(first.sources_involved).toEqual(['app', 'crm']);
    expect(first.disagreeing_fields).toEqual(['grade']);
  });

  it('keeps distinct rule IDs distinct for the same entity and field', () => {
    const paid = buildConflict('paid_but_no_deal', ['student:a'], ['app', 'crm', 'payments'], ['status']);
    const refund = buildConflict('refund_not_reflected', ['student:a'], ['app', 'payments'], ['status']);
    expect(paid.conflict_key).not.toBe(refund.conflict_key);
  });

  it('does not let narrative evidence mutate conflict identity', () => {
    const first = buildConflict('duplicate_payment', ['payment:1', 'payment:2'], ['payments'], ['payment_id'], { note: 'one' });
    const second = buildConflict('duplicate_payment', ['payment:1', 'payment:2'], ['payments'], ['payment_id'], { note: 'two' });
    expect(first.conflict_key).toBe(second.conflict_key);
  });
});

describe('clean-set false positive defenses', () => {
  it.each([1, 2, 5, 25])('keeps %d consistent entities conflict-free', (count) => {
    expect(evaluateInvariants(cleanFixture(count)).conflicts).toEqual([]);
  });

  it('normalizes harmless Gmail aliases without creating C4', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.guardian_email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.email = 'janedoe+crm@googlemail.com';
    fixtures.crmContacts[0]!.billing_owner_email = 'jane.doe@gmail.com';
    fixtures.payments[0]!.payer_email = 'janedoe+pay@gmail.com';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('normalizes formatting-only names without creating C6', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.first_name = '  `Student0` ';
    fixtures.crmContacts[0]!.first_name = 'STUDENT0';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not flag a legitimate deal-less CRM lead as paid-but-no-deal', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts.push({
      crm_id: 'lead-only',
      email: 'lead@example.test',
      first_name: 'Lead',
      last_name: 'Only',
      lifecycle_stage: 'lead',
      created_at: '2026-01-15T12:00:00.000Z',
      updated_at: '2026-01-15T12:00:00.000Z',
      role: 'lead'
    });
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not classify shared guardian emails as duplicate child identities', () => {
    const fixtures = siblingFixture();
    fixtures.payments.splice(1, 0, makePayment(1, fixtures.appStudents[1]!));
    fixtures.appEnrollments[1]!.stage = 'registered';
    fixtures.appEnrollments[1]!.deposit_paid_at = '2026-01-15T12:00:00.000Z';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not call a fee payment without a CRM deal C1', () => {
    const fixtures = cleanFixture();
    fixtures.crmDeals = [];
    fixtures.appEnrollments[0]!.crm_deal_id = null;
    fixtures.payments[0]!.type = 'fee';
    fixtures.payments[0]!.amount_cents = 10_000;
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('gives refund precedence over enrolled-but-unpaid', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.status = 'refunded';
    fixtures.appEnrollments[0]!.stage = 'enrolled';
    expect(conflictTypes(fixtures)).toEqual(['refund_not_reflected']);
  });
});

describe('C1 paid-but-no-deal', () => {
  it('flags a paid deposit with enrollment and no qualifying deal', () => {
    const fixtures = cleanFixture();
    fixtures.crmDeals = [];
    fixtures.appEnrollments[0]!.crm_deal_id = null;
    expectOnly(fixtures, 'paid_but_no_deal');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C1', disagreeing_fields: ['crm_deal_id'], sources_involved: ['app', 'crm', 'payments'] });
  });

  it('requires a real enrollment', () => {
    const fixtures = cleanFixture();
    fixtures.crmDeals = [];
    fixtures.appEnrollments = [];
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('requires a paid status', () => {
    const fixtures = cleanFixture();
    fixtures.crmDeals = [];
    fixtures.payments[0]!.status = 'refunded';
    fixtures.appEnrollments[0]!.deposit_paid_at = null;
    fixtures.appEnrollments[0]!.crm_deal_id = null;
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('accepts a deal associated through any resolved duplicate contact', () => {
    const fixtures = cleanFixture();
    const duplicate = { ...fixtures.crmContacts[0]!, crm_id: 'crm-duplicate' };
    fixtures.crmContacts.push(duplicate);
    fixtures.crmDeals[0]!.associated_contact_ids = ['crm-duplicate'];
    expect(conflictTypes(fixtures)).toEqual(['duplicate_by_email']);
  });
});

describe('C2 payment-with-no-person', () => {
  it('flags a payment that matches no supported identity key', () => {
    const fixtures = cleanFixture();
    fixtures.payments.push(makePayment(9, makeStudent(9), { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'orphan@example.test' }));
    expectOnly(fixtures, 'payment_with_no_person');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C2', entity_refs: ['payment:payment-record-9'], disagreeing_fields: ['person_link'] });
  });

  it('links by name plus DOB when external_ref and payer email differ', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.external_ref = undefined;
    fixtures.payments[0]!.payer_email = 'billing-owner@example.test';
    fixtures.crmContacts[0]!.billing_owner_email = 'billing-owner@example.test';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not force an ambiguous shared-email match', () => {
    const fixtures = siblingFixture();
    const orphan = makePayment(9, makeStudent(9), { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'shared-guardian@example.test' });
    fixtures.payments.push(orphan);
    expect(conflictTypes(fixtures)).toContain('payment_with_no_person');
  });
});

describe('C3 duplicate-by-email', () => {
  it('flags exactly one same-person pair in CRM', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts.push({ ...fixtures.crmContacts[0]!, crm_id: 'crm-duplicate' });
    expectOnly(fixtures, 'duplicate_by_email');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C3', entity_refs: ['crm:crm-0', 'crm:crm-duplicate'], disagreeing_fields: ['email'] });
  });

  it('uses normalized Gmail email for duplicate comparison', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.guardian_email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.billing_owner_email = 'jane.doe@gmail.com';
    fixtures.payments[0]!.payer_email = 'jane.doe@gmail.com';
    fixtures.crmContacts.push({ ...fixtures.crmContacts[0]!, crm_id: 'crm-duplicate', email: 'janedoe+copy@googlemail.com' });
    expectOnly(fixtures, 'duplicate_by_email');
  });

  it('does not pair distinct names and DOBs that share a household email', () => {
    const fixtures = siblingFixture();
    fixtures.payments.splice(1, 0, makePayment(1, fixtures.appStudents[1]!));
    fixtures.appEnrollments[1]!.stage = 'registered';
    expect(conflictTypes(fixtures)).not.toContain('duplicate_by_email');
  });

  it('does not flag lead records under the student duplicate policy', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts.push({ ...fixtures.crmContacts[0]!, crm_id: 'lead-copy', role: 'lead' });
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C4 same person with different emails', () => {
  it('flags materially different cross-source emails after name+DOB linkage', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.external_id = undefined;
    fixtures.crmContacts[0]!.email = 'different@example.test';
    expectOnly(fixtures, 'cross_source_email_mismatch');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C4', evidence: { identity: 'name_dob' } });
  });

  it('does not flag Gmail dot/plus variants', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.guardian_email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.email = 'janedoe+crm@googlemail.com';
    fixtures.crmContacts[0]!.billing_owner_email = 'jane.doe@gmail.com';
    fixtures.payments[0]!.payer_email = 'jane.doe@gmail.com';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not compare emails for an unlinked contact', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts.push(makeContact(9, makeStudent(9), { external_id: undefined, dob: undefined, email: 'different@example.test' }));
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C5 record in one required source only', () => {
  it('flags an active candidate present only in app', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.status = 'active_candidate';
    fixtures.crmContacts = [];
    fixtures.crmDeals = [];
    fixtures.appEnrollments = [];
    fixtures.payments = [];
    expectOnly(fixtures, 'required_source_missing');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C5', disagreeing_fields: ['source_presence'] });
  });

  it('does not apply the presence invariant to an ordinary unlinked draft', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts = [];
    fixtures.crmDeals = [];
    fixtures.appEnrollments = [];
    fixtures.payments = [];
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not flag when a required footprint exists in payments', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.status = 'active_candidate';
    fixtures.crmContacts = [];
    fixtures.crmDeals = [];
    fixtures.appEnrollments = [];
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C6 material field disagreement', () => {
  it('flags normalized grades that differ', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.grade = 7;
    fixtures.appStudents[0]!.grade = 'Grade 4';
    expectOnly(fixtures, 'material_field_disagreement');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C6', evidence: { app_grade: 4, crm_grade: 7 } });
  });

  it('treats Grade 4 and integer 4 as equal', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.grade = 'Grade 4';
    fixtures.appStudents[0]!.grade = 4;
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not evaluate an absent optional CRM grade', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.grade = undefined;
    fixtures.appStudents[0]!.grade = 7;
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C7 enrolled-but-unpaid', () => {
  it('flags a paid-implying enrollment with no payment record', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments[0]!.stage = 'enrolled';
    fixtures.appEnrollments[0]!.deposit_paid_at = null;
    fixtures.payments = [];
    expectOnly(fixtures, 'enrolled_but_unpaid');
  });

  it('does not flag an applied stage', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments[0]!.stage = 'applied';
    fixtures.appEnrollments[0]!.deposit_paid_at = null;
    fixtures.payments = [];
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not double-report a refund as missing payment', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments[0]!.stage = 'enrolled';
    fixtures.payments[0]!.status = 'refunded';
    expect(conflictTypes(fixtures)).toEqual(['refund_not_reflected']);
  });
});

describe('C8 dropped sibling', () => {
  it('flags exactly one missing downstream child in a household', () => {
    const fixtures = siblingFixture();
    expectOnly(fixtures, 'dropped_sibling');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C8', evidence: { sibling_count: 3, missing_student_id: fixtures.appStudents[1]!.id } });
  });

  it('does not flag when all siblings have downstream payments', () => {
    const fixtures = siblingFixture();
    fixtures.payments.push(makePayment(1, fixtures.appStudents[1]!));
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not guess dropped sibling when two children are missing', () => {
    const fixtures = siblingFixture();
    fixtures.payments = [fixtures.payments[0]!];
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('requires the expected applied stage', () => {
    const fixtures = siblingFixture();
    fixtures.appEnrollments[1]!.stage = 'draft';
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not infer payment absence when a household CRM member is unavailable', () => {
    const fixtures = siblingFixture();
    fixtures.crmContacts.pop();
    expect(conflictTypes(fixtures)).not.toContain('dropped_sibling');
  });
});

describe('C9 stale or misassociated CRM pointer', () => {
  it('flags a pointer to a missing deal', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments[0]!.crm_deal_id = 'does-not-exist';
    expectOnly(fixtures, 'stale_crm_pointer');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C9', evidence: { reason: 'missing' } });
  });

  it('flags a deal associated to another student', () => {
    const fixtures = cleanFixture(2);
    fixtures.appEnrollments[0]!.crm_deal_id = fixtures.crmDeals[1]!.deal_id;
    expectOnly(fixtures, 'stale_crm_pointer');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ evidence: { reason: 'misassociated' } });
  });

  it('accepts a null pointer where no pointer invariant applies', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments[0]!.crm_deal_id = null;
    fixtures.crmDeals = [];
    fixtures.payments[0]!.type = 'fee';
    fixtures.payments[0]!.amount_cents = 10_000;
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C10 merge-collapsed CRM record', () => {
  it('flags explicit evidence that one record carries two people', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.secondary_person = { first_name: 'Second', last_name: 'Child', dob: '2016-02-01', email: 'second@example.test' };
    expectOnly(fixtures, 'merge_collapsed_record');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C10', disagreeing_fields: ['secondary_person'] });
  });

  it('does not infer a merge solely from a secondary guardian field', () => {
    const fixtures = cleanFixture();
    fixtures.appStudents[0]!.guardian2_email = 'other-guardian@example.test';
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C11 duplicate payment', () => {
  it('flags two fixture records carrying the same payment ID', () => {
    const fixtures = cleanFixture();
    fixtures.payments.push({ ...fixtures.payments[0]!, fixture_record_id: 'payment-record-copy' });
    expectOnly(fixtures, 'duplicate_payment');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C11', entity_refs: ['payment:payment-record-0', 'payment:payment-record-copy'] });
  });

  it('does not dedupe equal amounts with distinct payment IDs', () => {
    const fixtures = cleanFixture();
    fixtures.payments.push({ ...fixtures.payments[0]!, fixture_record_id: 'payment-record-copy', payment_id: 'payment-copy' });
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not emit an unstable pair when more than two copies exist', () => {
    const fixtures = cleanFixture();
    fixtures.payments.push({ ...fixtures.payments[0]!, fixture_record_id: 'copy-1' }, { ...fixtures.payments[0]!, fixture_record_id: 'copy-2' });
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('C12 wrong amount', () => {
  it.each([
    ['fee', 10_000],
    ['deposit', 50_000],
    ['tuition', 250_000]
  ] as const)('accepts configured %s amount %d', (type, amount) => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.type = type;
    fixtures.payments[0]!.amount_cents = amount;
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it.each([
    ['fee', 1],
    ['deposit', 10_000],
    ['tuition', 50_000]
  ] as const)('flags incorrect %s amount %d', (type, amount) => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.type = type;
    fixtures.payments[0]!.amount_cents = amount;
    expectOnly(fixtures, 'wrong_amount_payment');
  });

  it('includes typed amount policy evidence', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.amount_cents = 100;
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C12', evidence: { actual: 100, expected: 50_000, currency: 'usd' } });
  });
});

describe('C13 refund not reflected', () => {
  it('flags refunded payment while app still records deposit paid', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.status = 'refunded';
    fixtures.appEnrollments[0]!.stage = 'enrolled';
    expectOnly(fixtures, 'refund_not_reflected');
  });

  it('does not flag once downstream paid marker is cleared', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.status = 'refunded';
    fixtures.appEnrollments[0]!.deposit_paid_at = null;
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('does not flag an ordinary paid payment', () => {
    expect(conflictTypes(cleanFixture())).toEqual([]);
  });
});

describe('C14 sensitive-field-only fix', () => {
  it('flags billing ownership mismatch as a hard-review case', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.billing_owner_email = 'other-owner@example.test';
    expectOnly(fixtures, 'sensitive_field_only_fix');
    expect(evaluateInvariants(fixtures).conflicts[0]).toMatchObject({ rule_id: 'C14', disagreeing_fields: ['billing_owner_email'] });
  });

  it('normalizes case before comparing billing ownership', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts[0]!.billing_owner_email = fixtures.payments[0]!.payer_email.toLocaleUpperCase('en-US');
    expect(conflictTypes(fixtures)).toEqual([]);
  });

  it('normalizes Gmail ownership aliases', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.payer_email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.billing_owner_email = 'janedoe+owner@googlemail.com';
    fixtures.appStudents[0]!.guardian_email = 'jane.doe@gmail.com';
    fixtures.crmContacts[0]!.email = 'jane.doe@gmail.com';
    expect(conflictTypes(fixtures)).toEqual([]);
  });
});

describe('partial source and unchecked semantics', () => {
  it.each([
    ['crm', 'failed'],
    ['crm', 'partial'],
    ['app', 'failed'],
    ['app', 'partial'],
    ['payments', 'failed'],
    ['payments', 'partial']
  ] as const)('does not manufacture conflicts when %s is %s', (source, state) => {
    const fixtures = cloneFixture(cleanFixture());
    fixtures.crmDeals = [];
    fixtures.payments = [];
    const availability = { crm: 'complete', app: 'complete', payments: 'complete' } as const;
    const evaluation = evaluateInvariants(fixtures, { ...availability, [source]: state });
    expect(evaluation.uncheckedRules.length).toBeGreaterThan(0);
    for (const unchecked of evaluation.uncheckedRules) expect(unchecked.reason).toContain(`source_unavailable:${source}`);
    expect(evaluation.conflicts.every((conflict) => !RULE_DEPENDENCIES[conflict.type].includes(source))).toBe(true);
  });

  it('marks all cross-source rules unchecked if every source fails', () => {
    const evaluation = evaluateInvariants(cleanFixture(), { crm: 'failed', app: 'failed', payments: 'failed' });
    expect(evaluation.conflicts).toEqual([]);
    expect(evaluation.uncheckedRules).toHaveLength(14);
  });

  it('still evaluates CRM-only duplicates when app is unavailable', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts.push({ ...fixtures.crmContacts[0]!, crm_id: 'crm-copy' });
    const evaluation = evaluateInvariants(fixtures, { crm: 'complete', app: 'failed', payments: 'complete' });
    expect(evaluation.conflicts.map(({ type }) => type)).toEqual(['duplicate_by_email']);
  });

  it('still evaluates payment-only amount rules when CRM is unavailable', () => {
    const fixtures = cleanFixture();
    fixtures.payments[0]!.amount_cents = 1;
    const evaluation = evaluateInvariants(fixtures, { crm: 'failed', app: 'complete', payments: 'complete' });
    expect(evaluation.conflicts.map(({ type }) => type)).toEqual(['wrong_amount_payment']);
  });

  it('sorts conflicts by stable key for replay', () => {
    const fixtures = cleanFixture(3);
    fixtures.crmDeals = [];
    fixtures.appEnrollments.forEach((enrollment) => { enrollment.crm_deal_id = null; });
    const keys = evaluateInvariants(fixtures).conflicts.map(({ conflict_key }) => conflict_key);
    expect(keys).toEqual([...keys].sort());
  });

  it('returns byte-equivalent conflict identities after source order changes', () => {
    const fixtures = cleanFixture(3);
    fixtures.crmDeals = [];
    fixtures.appEnrollments.forEach((enrollment) => { enrollment.crm_deal_id = null; });
    const first = evaluateInvariants(fixtures).conflicts.map(({ conflict_key }) => conflict_key);
    const second = evaluateInvariants({
      crmContacts: [...fixtures.crmContacts].reverse(),
      crmDeals: [...fixtures.crmDeals].reverse(),
      appStudents: [...fixtures.appStudents].reverse(),
      appEnrollments: [...fixtures.appEnrollments].reverse(),
      payments: [...fixtures.payments].reverse()
    }).conflicts.map(({ conflict_key }) => conflict_key);
    expect(second).toEqual(first);
  });
});
