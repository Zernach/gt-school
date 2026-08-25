import type { SourceRecord } from '../../src/sources/adapter.js';
import { lineageForRecord } from '../../src/ingestion/lineage.js';
import { buildCanonicalProjection, normalizedDisplayName, shapePublicEntityView } from '../../src/ingestion/projection.js';
import { cleanFixture, makeContact, makePayment, makeStudent, siblingFixture } from '../helpers/fixtures.js';

function record(entityKind: string, payload: Record<string, unknown>, sourceKind: 'crm' | 'app' | 'payments' = 'app'): SourceRecord {
  return {
    sourceKind,
    entityKind,
    sourceId: 'source-1',
    occurrence: 1,
    payload,
    observedAt: '2026-01-15T12:00:00.000Z'
  };
}

describe('field-level lineage', () => {
  it('records every material contact field in a stable order', () => {
    const rows = lineageForRecord(record('contact', makeContact() as Record<string, unknown>, 'crm'));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual([
      'email',
      'first_name',
      'last_name',
      'grade',
      'lifecycle_stage',
      'billing_owner_email',
      'created_at',
      'updated_at'
    ]);
  });

  it('records every material deal field', () => {
    const rows = lineageForRecord(record('deal', {
      pipeline: 'admissions',
      stage: 'closed_won',
      amount: 50_000,
      associated_contact_ids: ['crm-1'],
      created_at: '2026-01-15T12:00:00.000Z',
      updated_at: '2026-01-15T13:00:00.000Z'
    }, 'crm'));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual(['pipeline', 'stage', 'amount', 'associated_contact_ids', 'created_at', 'updated_at']);
  });

  it('records every material student field', () => {
    const rows = lineageForRecord(record('student', makeStudent() as Record<string, unknown>));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual([
      'first_name',
      'last_name',
      'dob',
      'grade',
      'guardian_email',
      'guardian2_email',
      'status',
      'created_at',
      'updated_at'
    ]);
  });

  it('records every material enrollment field', () => {
    const rows = lineageForRecord(record('enrollment', {
      student_id: 'student',
      stage: 'registered',
      deposit_paid_at: null,
      crm_deal_id: null,
      created_at: '2026-01-15T12:00:00.000Z',
      updated_at: '2026-01-15T12:00:00.000Z'
    }));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual(['student_id', 'stage', 'deposit_paid_at', 'crm_deal_id', 'created_at', 'updated_at']);
  });

  it('records every material payment field', () => {
    const rows = lineageForRecord(record('payment', makePayment() as Record<string, unknown>, 'payments'));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual([
      'payer_email',
      'payer_name',
      'amount_cents',
      'currency',
      'type',
      'status',
      'external_ref',
      'occurred_at'
    ]);
  });

  it('sorts fields for an unknown future entity instead of crashing', () => {
    const rows = lineageForRecord(record('future_entity', { z: 1, a: 2, middle: 3 }));
    expect(rows.map(({ fieldPath }) => fieldPath)).toEqual(['a', 'middle', 'z']);
    expect(rows.map(({ normalizedValue }) => normalizedValue)).toEqual([2, 3, 1]);
  });

  it('normalizes Gmail email variants while retaining the raw value', () => {
    const raw = ' Jane.Doe+school@GoogleMail.com ';
    const row = lineageForRecord(record('future_entity', { guardian_email: raw }))[0]!;
    expect(row.rawValue).toBe(raw);
    expect(row.normalizedValue).toBe('janedoe@gmail.com');
    expect(row.trace).toEqual(['trimmed_whitespace', 'case_folded', 'gmail_domain_canonicalized', 'gmail_plus_alias_removed', 'gmail_dots_removed']);
  });

  it('normalizes names and keeps all transformation evidence', () => {
    const row = lineageForRecord(record('future_entity', { first_name: '  `ALICE`  ' }))[0]!;
    expect(row.rawValue).toBe('  `ALICE`  ');
    expect(row.normalizedValue).toBe('alice');
    expect(row.trace).toEqual(['trimmed_whitespace', 'removed_wrapper_quote', 'case_folded']);
  });

  it('normalizes grades', () => {
    const row = lineageForRecord(record('future_entity', { grade: ' Grade 4 ' }))[0]!;
    expect(row.normalizedValue).toBe(4);
    expect(row.trace).toEqual(['grade_format_canonicalized']);
  });

  it('normalizes currency case', () => {
    const row = lineageForRecord(record('future_entity', { currency: 'USD' }))[0]!;
    expect(row.normalizedValue).toBe('usd');
    expect(row.trace).toEqual(['currency_case_folded']);
  });

  it('normalizes timestamps to UTC', () => {
    const row = lineageForRecord(record('future_entity', { occurred_at: '2026-01-15T07:00:00-05:00' }))[0]!;
    expect(row.normalizedValue).toBe('2026-01-15T12:00:00.000Z');
    expect(row.trace).toEqual(['timestamp_to_utc']);
  });

  it('marks absent material fields as missing and null', () => {
    const rows = lineageForRecord(record('contact', { email: 'person@example.test' }, 'crm'));
    expect(rows.find(({ fieldPath }) => fieldPath === 'grade')).toMatchObject({ rawValue: null, normalizedValue: null, trace: ['missing'] });
  });

  it('preserves explicit null without describing it as absent', () => {
    const rows = lineageForRecord(record('student', { guardian2_email: null }));
    expect(rows.find(({ fieldPath }) => fieldPath === 'guardian2_email')).toMatchObject({ rawValue: null, normalizedValue: null, trace: [] });
  });

  it.each([
    ['email', 'not-an-email', 'email_invalid'],
    ['first_name', '   ', 'name_empty'],
    ['grade', 'kindergarten', 'grade_invalid'],
    ['currency', 'dollars', 'currency_invalid'],
    ['created_at', 'yesterday', 'timestamp_invalid_rfc3339']
  ])('captures a %s normalization failure as data', (field, value, error) => {
    const row = lineageForRecord(record('future_entity', { [field]: value }))[0]!;
    expect(row.normalizedValue).toBeNull();
    expect(row.trace).toEqual([`normalization_error:${error}`]);
  });

  it('assigns the committed normalization version to every observation', () => {
    const rows = lineageForRecord(record('student', makeStudent() as Record<string, unknown>));
    expect(new Set(rows.map(({ version }) => version))).toEqual(new Set(['normalization-v1']));
  });

  it('does not mutate a source payload while deriving lineage', () => {
    const payload = makeStudent() as Record<string, unknown>;
    const before = structuredClone(payload);
    lineageForRecord(record('student', payload));
    expect(payload).toEqual(before);
  });
});

describe('canonical projection', () => {
  it('builds one joined student entity from all three sources', () => {
    const projection = buildCanonicalProjection(cleanFixture());
    expect(projection.entities).toHaveLength(1);
    expect(projection.entities[0]).toMatchObject({
      id: `entity:${makeStudent().id}`,
      entityKind: 'student',
      displayName: 'Student0 Example0',
      resolutionStatus: 'linked',
      matchMethod: 'hard_external_id',
      matchScoreBp: 9000,
      summary: {
        student_id: makeStudent().id,
        registered: true,
        enrollment_stage: 'registered',
        paid: true,
        payment_statuses: ['paid'],
        crm_stage: 'closed_won',
        crm_contact_ids: ['crm-0'],
        payment_ids: ['payment-record-0']
      }
    });
  });

  it('creates explicit links for student, enrollment, contact, payment, and deal', () => {
    const projection = buildCanonicalProjection(cleanFixture());
    expect(projection.links.map(({ sourceKind, entityKind, sourceId }) => `${sourceKind}:${entityKind}:${sourceId}`)).toEqual([
      `app:student:${makeStudent().id}`,
      `app:enrollment:${cleanFixture().appEnrollments[0]!.id}`,
      'crm:contact:crm-0',
      'crm:deal:deal-0',
      'payments:payment:payment-record-0'
    ]);
  });

  it('preserves hard-ID evidence on source links', () => {
    const projection = buildCanonicalProjection(cleanFixture());
    const student = projection.links.find(({ entityKind }) => entityKind === 'student');
    const contact = projection.links.find(({ entityKind }) => entityKind === 'contact');
    const payment = projection.links.find(({ entityKind }) => entityKind === 'payment');
    expect(student).toMatchObject({ matchMethod: 'hard_external_id', matchScoreBp: 10_000, evidence: { source_primary_key: makeStudent().id } });
    expect(contact).toMatchObject({ matchMethod: 'hard_external_id', matchScoreBp: 10_000, evidence: { external_id: makeStudent().id } });
    expect(payment).toMatchObject({ matchMethod: 'hard_external_id', matchScoreBp: 10_000, evidence: { external_ref: makeStudent().id } });
  });

  it('falls back to deterministic name and DOB when IDs are absent', () => {
    const fixtures = cleanFixture();
    delete fixtures.crmContacts[0]!.external_id;
    delete fixtures.payments[0]!.external_ref;
    fixtures.crmContacts[0]!.email = 'different@example.test';
    fixtures.payments[0]!.payer_email = 'different@example.test';
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.entities[0]?.matchMethod).toBe('name_dob');
    expect(projection.links.filter(({ sourceKind }) => sourceKind !== 'app').map(({ matchMethod }) => matchMethod)).toEqual(['name_dob', 'associated_contact', 'name_dob']);
  });

  it('represents a source-only lead as an unlinked canonical entity', () => {
    const fixtures = cleanFixture();
    const lead = makeContact(7, makeStudent(7), { external_id: undefined, dob: undefined, email: 'lead-only@example.test', role: 'lead' });
    fixtures.crmContacts.push(lead);
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.entities.find(({ id }) => id === 'entity:crm:crm-7')).toMatchObject({
      entityKind: 'lead',
      displayName: 'Student7 Example7',
      resolutionStatus: 'unlinked',
      matchMethod: 'none',
      matchScoreBp: 0
    });
    expect(projection.links.find(({ sourceId }) => sourceId === 'crm-7')).toMatchObject({ sourceKind: 'crm', matchMethod: 'none', matchScoreBp: 0 });
  });

  it('represents an orphan payment without inventing a student', () => {
    const fixtures = cleanFixture();
    const orphan = makePayment(9, makeStudent(9), {
      fixture_record_id: 'orphan-record',
      external_ref: undefined,
      student_name: undefined,
      student_dob: undefined,
      payer_email: 'orphan@example.test',
      payer_name: 'Orphan Fixture'
    });
    fixtures.payments.push(orphan);
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.entities.find(({ id }) => id === 'entity:payment:orphan-record')).toMatchObject({
      entityKind: 'unlinked_payment',
      displayName: 'Orphan Fixture',
      resolutionStatus: 'unlinked',
      matchMethod: 'none',
      matchScoreBp: 0
    });
  });

  it('does not convert an unlinked app student into a lead', () => {
    const fixtures = cleanFixture();
    fixtures.crmContacts = [];
    fixtures.crmDeals = [];
    fixtures.payments = [];
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.entities).toEqual([expect.objectContaining({ entityKind: 'student', resolutionStatus: 'unlinked', matchMethod: 'none', matchScoreBp: 0 })]);
  });

  it('derives registered, stage, paid, and source IDs from actual children', () => {
    const fixtures = cleanFixture();
    fixtures.appEnrollments = [];
    fixtures.payments[0]!.status = 'refunded';
    fixtures.crmDeals = [];
    const summary = buildCanonicalProjection(fixtures).entities[0]!.summary;
    expect(summary).toMatchObject({ registered: false, enrollment_stage: null, paid: false, payment_statuses: ['refunded'], crm_stage: null });
  });

  it('retains raw synthetic evidence behind the unified entity view', () => {
    const fixtures = cleanFixture();
    const raw = buildCanonicalProjection(fixtures).entities[0]!.summary.raw;
    expect(raw).toEqual({
      app: fixtures.appStudents[0],
      crm: fixtures.crmContacts,
      payments: fixtures.payments,
      enrollment: fixtures.appEnrollments[0],
      deals: fixtures.crmDeals
    });
  });

  it('strips internal raw payloads from the public entity oracle', () => {
    const fixtures = cleanFixture();
    const projection = buildCanonicalProjection(fixtures);
    const view = shapePublicEntityView(projection, projection.entities[0]!.id);
    expect(view.summary).toEqual({
      student_id: makeStudent().id,
      registered: true,
      enrollment_stage: 'registered',
      paid: true,
      payment_statuses: ['paid'],
      crm_stage: 'closed_won',
      crm_contact_ids: ['crm-0'],
      payment_ids: ['payment-record-0']
    });
    expect(view).not.toHaveProperty('summary.raw');
  });

  it('keeps siblings distinct even when guardians and household match', () => {
    const fixtures = siblingFixture();
    const projection = buildCanonicalProjection(fixtures);
    const students = projection.entities.filter(({ entityKind }) => entityKind === 'student');
    expect(students).toHaveLength(3);
    expect(new Set(students.map(({ id }) => id)).size).toBe(3);
  });

  it('creates one household with all distinct child members', () => {
    const fixtures = siblingFixture();
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.households).toHaveLength(1);
    expect(projection.households[0]).toMatchObject({ id: 'household-test-1' });
    expect(projection.households[0]?.members).toEqual(fixtures.appStudents.map(({ id }) => `entity:${id}`));
    expect(projection.households[0]?.guardianEmailHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses a non-reversible guardian hash rather than storing household email', () => {
    const fixtures = siblingFixture();
    const serialized = JSON.stringify(buildCanonicalProjection(fixtures).households);
    expect(serialized).not.toContain(fixtures.appStudents[0]!.guardian_email);
  });

  it('creates separate households in stable ID order', () => {
    const fixtures = cleanFixture(2);
    fixtures.appStudents[0]!.household_id = 'household-z';
    fixtures.appStudents[1]!.household_id = 'household-a';
    const projection = buildCanonicalProjection(fixtures);
    expect(projection.households.map(({ id }) => id)).toEqual(['household-a', 'household-z']);
  });

  it('sorts entities and links deterministically independent of source input order', () => {
    const forward = cleanFixture(4);
    const reverse = structuredClone(forward);
    reverse.appStudents.reverse();
    reverse.appEnrollments.reverse();
    reverse.crmContacts.reverse();
    reverse.crmDeals.reverse();
    reverse.payments.reverse();
    expect(buildCanonicalProjection(reverse)).toEqual(buildCanonicalProjection(forward));
  });

  it('is replay deterministic and does not mutate fixtures', () => {
    const fixtures = cleanFixture(5);
    const before = structuredClone(fixtures);
    const first = buildCanonicalProjection(fixtures);
    const second = buildCanonicalProjection(fixtures);
    expect(second).toEqual(first);
    expect(fixtures).toEqual(before);
  });

  it.each([
    [' Ada ', '`LOVELACE`', 'ada lovelace'],
    ['ALAN', 'Turing  ', 'alan turing'],
    [' Grace  Brewster ', ' Murray Hopper ', 'grace brewster murray hopper']
  ])('normalizes display name %j %j', (first, last, expected) => {
    expect(normalizedDisplayName(first, last)).toBe(expected);
  });
});
