import {
  appEnrollmentSchema,
  appStudentSchema,
  conflictTypes,
  crmContactSchema,
  crmDealSchema,
  paymentSchema
} from '../../src/domain/fixture-types.js';
import { makeContact, makeDeal, makeEnrollment, makePayment, makeStudent } from '../helpers/fixtures.js';

function omit<T extends Record<string, unknown>>(record: T, key: string): Record<string, unknown> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

describe('CRM contact fixture contract', () => {
  const valid = makeContact();

  it('accepts the complete minimum and optional synthetic shape', () => {
    expect(crmContactSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'crm_id',
    'email',
    'first_name',
    'last_name',
    'lifecycle_stage',
    'created_at',
    'updated_at',
    'role'
  ])('requires %s', (field) => {
    expect(crmContactSchema.safeParse(omit(valid, field)).success).toBe(false);
  });

  it.each([
    ['crm_id', ''],
    ['email', ''],
    ['first_name', ''],
    ['last_name', ''],
    ['lifecycle_stage', ''],
    ['created_at', 'short'],
    ['updated_at', 'short'],
    ['external_id', '']
  ])('rejects invalid %s', (field, value) => {
    expect(crmContactSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it.each(['student', 'lead'])('accepts role %s', (role) => {
    expect(crmContactSchema.parse({ ...valid, role }).role).toBe(role);
  });

  it.each(['customer', 'guardian', '', null, 1])('rejects unsupported role %j', (role) => {
    expect(crmContactSchema.safeParse({ ...valid, role }).success).toBe(false);
  });

  it('accepts a merge-collapse secondary person shape', () => {
    const secondary_person = {
      first_name: 'Second',
      last_name: 'Person',
      dob: '2012-03-04',
      email: 'second@example.test'
    };
    expect(crmContactSchema.parse({ ...valid, secondary_person }).secondary_person).toEqual(secondary_person);
  });

  it.each(['first_name', 'last_name', 'dob', 'email'])('requires secondary_person.%s', (field) => {
    const secondary = { first_name: 'Second', last_name: 'Person', dob: '2012-03-04', email: 'second@example.test' };
    expect(crmContactSchema.safeParse({ ...valid, secondary_person: omit(secondary, field) }).success).toBe(false);
  });

  it('rejects an unknown top-level field instead of silently dropping it', () => {
    expect(crmContactSchema.safeParse({ ...valid, production_token: 'never' }).success).toBe(false);
  });
});

describe('CRM deal fixture contract', () => {
  const valid = makeDeal();

  it('accepts a valid HubSpot-shaped deal', () => {
    expect(crmDealSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'deal_id',
    'name',
    'pipeline',
    'stage',
    'amount',
    'associated_contact_ids',
    'created_at',
    'updated_at'
  ])('requires %s', (field) => {
    expect(crmDealSchema.safeParse(omit(valid, field)).success).toBe(false);
  });

  it.each([
    ['deal_id', ''],
    ['name', ''],
    ['pipeline', ''],
    ['stage', ''],
    ['amount', -1],
    ['amount', 1.5],
    ['amount', '50000'],
    ['associated_contact_ids', 'crm-1'],
    ['associated_contact_ids', [1]],
    ['created_at', 'short'],
    ['updated_at', 'short']
  ])('rejects invalid %s=%j', (field, value) => {
    expect(crmDealSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it('allows an empty associated contact list so the invariant can flag it', () => {
    expect(crmDealSchema.parse({ ...valid, associated_contact_ids: [] }).associated_contact_ids).toEqual([]);
  });

  it('rejects unknown fields under the strict source contract', () => {
    expect(crmDealSchema.safeParse({ ...valid, hidden_write_target: true }).success).toBe(false);
  });
});

describe('app student fixture contract', () => {
  const valid = makeStudent();

  it('accepts a valid Postgres app student', () => {
    expect(appStudentSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'id',
    'first_name',
    'last_name',
    'dob',
    'grade',
    'guardian_email',
    'guardian2_email',
    'status',
    'enrollment_year',
    'created_at',
    'updated_at'
  ])('requires %s', (field) => {
    expect(appStudentSchema.safeParse(omit(valid, field)).success).toBe(false);
  });

  it('allows the realistic nullable second guardian', () => {
    expect(appStudentSchema.parse({ ...valid, guardian2_email: null }).guardian2_email).toBeNull();
  });

  it('allows a supplied second guardian', () => {
    expect(appStudentSchema.parse({ ...valid, guardian2_email: 'guardian2@example.test' }).guardian2_email).toBe('guardian2@example.test');
  });

  it.each([
    ['id', 'not-a-uuid'],
    ['first_name', ''],
    ['last_name', ''],
    ['dob', 20120101],
    ['grade', null],
    ['grade', {}],
    ['guardian_email', 'x'],
    ['guardian2_email', 42],
    ['status', ''],
    ['enrollment_year', 2026.5],
    ['enrollment_year', '2026'],
    ['created_at', 'short'],
    ['updated_at', 'short']
  ])('rejects invalid %s=%j', (field, value) => {
    expect(appStudentSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it.each([0, 12, 'Grade 4', '4'])('accepts raw grade representation %j for later normalization', (grade) => {
    expect(appStudentSchema.safeParse({ ...valid, grade }).success).toBe(true);
  });

  it('rejects additional source fields to surface schema drift', () => {
    expect(appStudentSchema.safeParse({ ...valid, unknown_column: 'value' }).success).toBe(false);
  });
});

describe('app enrollment fixture contract', () => {
  const valid = makeEnrollment();

  it('accepts a valid app enrollment', () => {
    expect(appEnrollmentSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'id',
    'student_id',
    'program',
    'stage',
    'deposit_paid_at',
    'crm_deal_id',
    'created_at',
    'updated_at'
  ])('requires %s even when its value is nullable', (field) => {
    expect(appEnrollmentSchema.safeParse(omit(valid, field)).success).toBe(false);
  });

  it('accepts null deposit and CRM pointer values', () => {
    const parsed = appEnrollmentSchema.parse({ ...valid, deposit_paid_at: null, crm_deal_id: null });
    expect(parsed.deposit_paid_at).toBeNull();
    expect(parsed.crm_deal_id).toBeNull();
  });

  it.each([
    ['id', 'not-a-uuid'],
    ['student_id', 'not-a-uuid'],
    ['program', ''],
    ['stage', ''],
    ['deposit_paid_at', 'short'],
    ['deposit_paid_at', 1],
    ['crm_deal_id', 1],
    ['created_at', 'short'],
    ['updated_at', 'short']
  ])('rejects invalid %s=%j', (field, value) => {
    expect(appEnrollmentSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(appEnrollmentSchema.safeParse({ ...valid, source_writer: true }).success).toBe(false);
  });
});

describe('payment fixture contract', () => {
  const valid = makePayment();

  it('accepts a valid Stripe-shaped fixture payment', () => {
    expect(paymentSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    'fixture_record_id',
    'payment_id',
    'payer_email',
    'payer_name',
    'amount_cents',
    'currency',
    'type',
    'status',
    'occurred_at'
  ])('requires %s', (field) => {
    expect(paymentSchema.safeParse(omit(valid, field)).success).toBe(false);
  });

  it.each(['fee', 'deposit', 'tuition'])('accepts supported payment type %s', (type) => {
    expect(paymentSchema.parse({ ...valid, type }).type).toBe(type);
  });

  it.each(['paid', 'refunded'])('accepts supported payment status %s', (status) => {
    expect(paymentSchema.parse({ ...valid, status }).status).toBe(status);
  });

  it.each([
    ['fixture_record_id', ''],
    ['payment_id', ''],
    ['payer_email', 'x'],
    ['payer_name', ''],
    ['amount_cents', -1],
    ['amount_cents', 1.5],
    ['amount_cents', '50000'],
    ['currency', 'US'],
    ['currency', 'USDD'],
    ['type', 'charge'],
    ['status', 'failed'],
    ['occurred_at', 'short'],
    ['external_ref', ''],
    ['student_name', ''],
    ['student_dob', 20120101]
  ])('rejects invalid %s=%j', (field, value) => {
    expect(paymentSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it.each(['usd', 'USD', 'eUr'])('allows three-character raw currency %s for later normalization', (currency) => {
    expect(paymentSchema.safeParse({ ...valid, currency }).success).toBe(true);
  });

  it('supports an omitted imperfect cross-source ID', () => {
    const value = omit(valid, 'external_ref');
    expect(paymentSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown fields to make provider drift visible', () => {
    expect(paymentSchema.safeParse({ ...valid, source_api_key: 'never' }).success).toBe(false);
  });
});

describe('conflict type contract', () => {
  it('contains every mandated C1-C14 rule exactly once', () => {
    expect(conflictTypes).toEqual([
      'paid_but_no_deal',
      'payment_with_no_person',
      'duplicate_by_email',
      'cross_source_email_mismatch',
      'required_source_missing',
      'material_field_disagreement',
      'enrolled_but_unpaid',
      'dropped_sibling',
      'stale_crm_pointer',
      'merge_collapsed_record',
      'duplicate_payment',
      'wrong_amount_payment',
      'refund_not_reflected',
      'sensitive_field_only_fix'
    ]);
    expect(new Set(conflictTypes).size).toBe(14);
  });
});
