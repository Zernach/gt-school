import type { AppEnrollment, AppStudent, CrmContact, CrmDeal, FixtureSet, Payment } from '../../src/domain/fixture-types.js';
import { stableUuid } from '../../src/domain/stable.js';

export const FIXED_TIME = '2026-01-15T12:00:00.000Z';

export function studentId(index: number): string {
  return stableUuid(`test-student:${index}`);
}

export function makeStudent(index = 0, overrides: Partial<AppStudent> = {}): AppStudent {
  return {
    id: studentId(index),
    first_name: `Student${index}`,
    last_name: `Example${index}`,
    dob: `201${index % 8}-01-${String((index % 27) + 1).padStart(2, '0')}`,
    grade: index % 8,
    guardian_email: `guardian-${index}@example.test`,
    guardian2_email: null,
    status: 'active',
    enrollment_year: 2026,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    ...overrides
  };
}

export function makeContact(index = 0, student = makeStudent(index), overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    crm_id: `crm-${index}`,
    email: student.guardian_email,
    first_name: student.first_name,
    last_name: student.last_name,
    lifecycle_stage: 'student',
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    external_id: student.id,
    dob: student.dob,
    grade: student.grade,
    role: 'student',
    billing_owner_email: student.guardian_email,
    ...overrides
  };
}

export function makeDeal(index = 0, overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    deal_id: `deal-${index}`,
    name: `Enrollment ${index}`,
    pipeline: 'admissions',
    stage: 'closed_won',
    amount: 50_000,
    associated_contact_ids: [`crm-${index}`],
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    ...overrides
  };
}

export function makeEnrollment(index = 0, student = makeStudent(index), overrides: Partial<AppEnrollment> = {}): AppEnrollment {
  return {
    id: stableUuid(`test-enrollment:${index}`),
    student_id: student.id,
    program: 'Test Academy',
    stage: 'registered',
    deposit_paid_at: FIXED_TIME,
    crm_deal_id: `deal-${index}`,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    ...overrides
  };
}

export function makePayment(index = 0, student = makeStudent(index), overrides: Partial<Payment> = {}): Payment {
  return {
    fixture_record_id: `payment-record-${index}`,
    payment_id: `payment-${index}`,
    payer_email: student.guardian_email,
    payer_name: `${student.first_name} ${student.last_name}`,
    amount_cents: 50_000,
    currency: 'usd',
    type: 'deposit',
    status: 'paid',
    occurred_at: FIXED_TIME,
    external_ref: student.id,
    student_name: `${student.first_name} ${student.last_name}`,
    student_dob: student.dob,
    ...overrides
  };
}

export function cleanFixture(count = 1): FixtureSet {
  const appStudents = Array.from({ length: count }, (_, index) => makeStudent(index));
  return {
    appStudents,
    crmContacts: appStudents.map((student, index) => makeContact(index, student)),
    crmDeals: appStudents.map((_, index) => makeDeal(index)),
    appEnrollments: appStudents.map((student, index) => makeEnrollment(index, student)),
    payments: appStudents.map((student, index) => makePayment(index, student))
  };
}

export function siblingFixture(): FixtureSet {
  const guardian = 'shared-guardian@example.test';
  const household = 'household-test-1';
  const students = Array.from({ length: 3 }, (_, index) => makeStudent(index, { guardian_email: guardian, household_id: household }));
  const contacts = students.map((student, index) => makeContact(index, student, { email: guardian, household_id: household }));
  const enrollments = students.map((student, index) => makeEnrollment(index, student, index === 1 ? { stage: 'applied', deposit_paid_at: null } : {}));
  const payments = [makePayment(0, students[0]!), makePayment(2, students[2]!)];
  return { appStudents: students, crmContacts: contacts, crmDeals: students.map((_, index) => makeDeal(index)), appEnrollments: enrollments, payments };
}

export function cloneFixture(fixtures: FixtureSet): FixtureSet {
  return structuredClone(fixtures);
}
