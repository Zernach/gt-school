import type { Availability, ConflictType, DetectedConflict, FixtureSet, SourceKind } from './fixture-types.js';
import { resolveFixtureIdentities } from './identity.js';
import { normalizeEmail, normalizeGrade, normalizeName } from './normalization.js';
import { stableKey } from './stable.js';

export const RULE_SET_VERSION = 'invariants-v1';

const RULE_BY_TYPE: Record<ConflictType, string> = {
  paid_but_no_deal: 'C1',
  payment_with_no_person: 'C2',
  duplicate_by_email: 'C3',
  cross_source_email_mismatch: 'C4',
  required_source_missing: 'C5',
  material_field_disagreement: 'C6',
  enrolled_but_unpaid: 'C7',
  dropped_sibling: 'C8',
  stale_crm_pointer: 'C9',
  merge_collapsed_record: 'C10',
  duplicate_payment: 'C11',
  wrong_amount_payment: 'C12',
  refund_not_reflected: 'C13',
  sensitive_field_only_fix: 'C14'
};

export const RULE_DEPENDENCIES: Record<ConflictType, SourceKind[]> = {
  paid_but_no_deal: ['crm', 'app', 'payments'],
  payment_with_no_person: ['crm', 'app', 'payments'],
  duplicate_by_email: ['crm'],
  cross_source_email_mismatch: ['crm', 'app'],
  required_source_missing: ['crm', 'app', 'payments'],
  material_field_disagreement: ['crm', 'app'],
  enrolled_but_unpaid: ['app', 'payments'],
  dropped_sibling: ['crm', 'app', 'payments'],
  stale_crm_pointer: ['crm', 'app'],
  merge_collapsed_record: ['crm', 'app'],
  duplicate_payment: ['payments'],
  wrong_amount_payment: ['payments'],
  refund_not_reflected: ['app', 'payments'],
  sensitive_field_only_fix: ['crm', 'payments']
};

export function buildConflict(
  type: ConflictType,
  entityRefs: string[],
  sources: SourceKind[],
  fields: string[],
  evidence: Record<string, unknown> = {}
): DetectedConflict {
  const normalizedRefs = [...entityRefs].sort();
  const normalizedSources = [...new Set(sources)].sort() as SourceKind[];
  const normalizedFields = [...new Set(fields)].sort();
  const ruleId = RULE_BY_TYPE[type];
  const conflictKey = stableKey('conflict', { ruleId, ruleVersion: '1.0.0', entityRefs: normalizedRefs, fields: normalizedFields });
  return {
    conflict_key: conflictKey,
    rule_id: ruleId,
    rule_version: '1.0.0',
    type,
    entity_refs: normalizedRefs,
    sources_involved: normalizedSources,
    disagreeing_fields: normalizedFields,
    expected_verdict: 'fail',
    evidence
  };
}

export interface InvariantEvaluation {
  conflicts: DetectedConflict[];
  uncheckedRules: Array<{ ruleId: string; reason: string }>;
}

export function evaluateInvariants(
  fixtures: FixtureSet,
  availability: Record<SourceKind, Availability> = { crm: 'complete', app: 'complete', payments: 'complete' }
): InvariantEvaluation {
  const enabled = (type: ConflictType): boolean => RULE_DEPENDENCIES[type].every((source) => availability[source] === 'complete');
  const uncheckedRules = Object.entries(RULE_DEPENDENCIES)
    .filter(([, dependencies]) => dependencies.some((source) => availability[source] !== 'complete'))
    .map(([type, dependencies]) => ({
      ruleId: RULE_BY_TYPE[type as ConflictType],
      reason: `source_unavailable:${dependencies.filter((source) => availability[source] !== 'complete').join(',')}`
    }));
  const conflicts: DetectedConflict[] = [];
  const { contactStudentIds, paymentStudentIds } = resolveFixtureIdentities(fixtures);
  const studentsById = new Map(fixtures.appStudents.map((student) => [student.id, student]));
  const enrollmentsByStudent = new Map(fixtures.appEnrollments.map((enrollment) => [enrollment.student_id, enrollment]));
  const contactsByStudent = new Map<string, typeof fixtures.crmContacts>();
  for (const contact of fixtures.crmContacts) {
    const studentId = contactStudentIds.get(contact.crm_id);
    if (!studentId) continue;
    const contacts = contactsByStudent.get(studentId) ?? [];
    contacts.push(contact);
    contactsByStudent.set(studentId, contacts);
  }
  const paymentsByStudent = new Map<string, typeof fixtures.payments>();
  for (const payment of fixtures.payments) {
    const studentId = paymentStudentIds.get(payment.fixture_record_id);
    if (!studentId) continue;
    const payments = paymentsByStudent.get(studentId) ?? [];
    payments.push(payment);
    paymentsByStudent.set(studentId, payments);
  }
  const dealsByStudent = new Map<string, typeof fixtures.crmDeals>();
  for (const deal of fixtures.crmDeals) {
    const studentIds = new Set(deal.associated_contact_ids.map((id) => contactStudentIds.get(id)).filter((id): id is string => Boolean(id)));
    for (const studentId of studentIds) {
      const deals = dealsByStudent.get(studentId) ?? [];
      deals.push(deal);
      dealsByStudent.set(studentId, deals);
    }
  }

  if (enabled('paid_but_no_deal')) {
    for (const [studentId, payments] of paymentsByStudent) {
      const payment = payments.find(({ status, type }) => status === 'paid' && type === 'deposit');
      const enrollment = enrollmentsByStudent.get(studentId);
      if (payment && enrollment && !(dealsByStudent.get(studentId)?.length)) {
        conflicts.push(buildConflict('paid_but_no_deal', [`student:${studentId}`, `payment:${payment.fixture_record_id}`], ['app', 'crm', 'payments'], ['crm_deal_id'], { payment_id: payment.payment_id, enrollment_id: enrollment.id }));
      }
    }
  }

  if (enabled('payment_with_no_person')) {
    for (const payment of fixtures.payments) {
      if (!paymentStudentIds.has(payment.fixture_record_id)) {
        conflicts.push(buildConflict('payment_with_no_person', [`payment:${payment.fixture_record_id}`], ['app', 'crm', 'payments'], ['person_link'], { payment_id: payment.payment_id }));
      }
    }
  }

  if (enabled('duplicate_by_email')) {
    const groups = new Map<string, typeof fixtures.crmContacts>();
    for (const contact of fixtures.crmContacts.filter(({ role }) => role === 'student')) {
      const email = normalizeEmail(contact.email).value;
      const group = groups.get(email) ?? [];
      group.push(contact);
      groups.set(email, group);
    }
    for (const [email, contacts] of groups) {
      const byPerson = new Map<string, typeof fixtures.crmContacts>();
      for (const contact of contacts) {
        const personKey = `${normalizeName(contact.first_name).value}|${normalizeName(contact.last_name).value}|${contact.dob ?? ''}`;
        const samePerson = byPerson.get(personKey) ?? [];
        samePerson.push(contact);
        byPerson.set(personKey, samePerson);
      }
      for (const samePerson of byPerson.values()) {
        if (samePerson.length === 2) {
          conflicts.push(buildConflict('duplicate_by_email', samePerson.map(({ crm_id }) => `crm:${crm_id}`), ['crm'], ['email'], { normalized_email: email }));
        }
      }
    }
  }

  if (enabled('cross_source_email_mismatch')) {
    for (const [studentId, contacts] of contactsByStudent) {
      const student = studentsById.get(studentId);
      const contact = contacts[0];
      if (!student || !contact) continue;
      const appEmail = normalizeEmail(student.guardian_email).value;
      const crmEmail = normalizeEmail(contact.email).value;
      if (appEmail !== crmEmail) conflicts.push(buildConflict('cross_source_email_mismatch', [`student:${studentId}`, `crm:${contact.crm_id}`], ['app', 'crm'], ['email'], { app_email: appEmail, crm_email: crmEmail, identity: 'name_dob' }));
    }
  }

  if (enabled('required_source_missing')) {
    for (const student of fixtures.appStudents) {
      if (student.status === 'active_candidate' && !contactsByStudent.has(student.id) && !paymentsByStudent.has(student.id) && !enrollmentsByStudent.has(student.id)) {
        conflicts.push(buildConflict('required_source_missing', [`student:${student.id}`], ['app', 'crm', 'payments'], ['source_presence'], { required: ['crm', 'payments'] }));
      }
    }
  }

  if (enabled('material_field_disagreement')) {
    for (const [studentId, contacts] of contactsByStudent) {
      const student = studentsById.get(studentId);
      const contact = contacts[0];
      if (!student || !contact || contact.grade === undefined) continue;
      const appGrade = normalizeGrade(student.grade).value;
      const crmGrade = normalizeGrade(contact.grade).value;
      if (appGrade !== crmGrade) conflicts.push(buildConflict('material_field_disagreement', [`student:${studentId}`, `crm:${contact.crm_id}`], ['app', 'crm'], ['grade'], { app_grade: appGrade, crm_grade: crmGrade }));
    }
  }

  if (enabled('enrolled_but_unpaid')) {
    for (const enrollment of fixtures.appEnrollments) {
      if (enrollment.stage !== 'enrolled') continue;
      const payments = paymentsByStudent.get(enrollment.student_id) ?? [];
      if (payments.length === 0) conflicts.push(buildConflict('enrolled_but_unpaid', [`student:${enrollment.student_id}`, `enrollment:${enrollment.id}`], ['app', 'payments'], ['payment_id'], { stage: enrollment.stage }));
    }
  }

  if (enabled('dropped_sibling')) {
    const householdMembers = new Map<string, string[]>();
    for (const student of fixtures.appStudents) {
      if (!student.household_id) continue;
      const members = householdMembers.get(student.household_id) ?? [];
      members.push(student.id);
      householdMembers.set(student.household_id, members);
    }
    for (const [householdId, members] of householdMembers) {
      const missing = members.filter((studentId) => !paymentsByStudent.has(studentId));
      if (missing.length !== 1 || members.some((studentId) => !contactsByStudent.has(studentId))) continue;
      const studentId = missing[0];
      const enrollment = studentId ? enrollmentsByStudent.get(studentId) : undefined;
      if (studentId && enrollment?.stage === 'applied') conflicts.push(buildConflict('dropped_sibling', [`student:${studentId}`, `household:${householdId}`], ['app', 'crm', 'payments'], ['household_member_payment'], { sibling_count: members.length, missing_student_id: studentId }));
    }
  }

  if (enabled('stale_crm_pointer')) {
    const dealsById = new Map(fixtures.crmDeals.map((deal) => [deal.deal_id, deal]));
    for (const enrollment of fixtures.appEnrollments) {
      if (!enrollment.crm_deal_id) continue;
      const deal = dealsById.get(enrollment.crm_deal_id);
      const belongs = deal?.associated_contact_ids.some((contactId) => contactStudentIds.get(contactId) === enrollment.student_id) ?? false;
      if (!belongs) conflicts.push(buildConflict('stale_crm_pointer', [`student:${enrollment.student_id}`, `enrollment:${enrollment.id}`], ['app', 'crm'], ['crm_deal_id'], { crm_deal_id: enrollment.crm_deal_id, reason: deal ? 'misassociated' : 'missing' }));
    }
  }

  if (enabled('merge_collapsed_record')) {
    for (const contact of fixtures.crmContacts) {
      if (contact.secondary_person) conflicts.push(buildConflict('merge_collapsed_record', [`crm:${contact.crm_id}`], ['crm', 'app'], ['secondary_person'], { secondary_person: contact.secondary_person }));
    }
  }

  if (enabled('duplicate_payment')) {
    const paymentsById = new Map<string, typeof fixtures.payments>();
    for (const payment of fixtures.payments) {
      const group = paymentsById.get(payment.payment_id) ?? [];
      group.push(payment);
      paymentsById.set(payment.payment_id, group);
    }
    for (const payments of paymentsById.values()) {
      if (payments.length === 2) conflicts.push(buildConflict('duplicate_payment', payments.map(({ fixture_record_id }) => `payment:${fixture_record_id}`), ['payments'], ['payment_id'], { payment_id: payments[0]?.payment_id }));
    }
  }

  if (enabled('wrong_amount_payment')) {
    const expectedAmounts: Record<string, number> = { fee: 10_000, deposit: 50_000, tuition: 250_000 };
    for (const payment of fixtures.payments) {
      if (payment.amount_cents !== expectedAmounts[payment.type]) conflicts.push(buildConflict('wrong_amount_payment', [`payment:${payment.fixture_record_id}`], ['payments'], ['amount_cents'], { actual: payment.amount_cents, expected: expectedAmounts[payment.type], currency: payment.currency }));
    }
  }

  if (enabled('refund_not_reflected')) {
    for (const payment of fixtures.payments.filter(({ status }) => status === 'refunded')) {
      const studentId = paymentStudentIds.get(payment.fixture_record_id);
      const enrollment = studentId ? enrollmentsByStudent.get(studentId) : undefined;
      if (studentId && enrollment?.deposit_paid_at) conflicts.push(buildConflict('refund_not_reflected', [`student:${studentId}`, `payment:${payment.fixture_record_id}`], ['app', 'payments'], ['deposit_paid_at', 'payment_status'], { payment_status: 'refunded', enrollment_stage: enrollment.stage }));
    }
  }

  if (enabled('sensitive_field_only_fix')) {
    for (const [studentId, contacts] of contactsByStudent) {
      const payment = paymentsByStudent.get(studentId)?.[0];
      const contact = contacts[0];
      if (!payment || !contact?.billing_owner_email) continue;
      if (normalizeEmail(payment.payer_email).value !== normalizeEmail(contact.billing_owner_email).value) {
        conflicts.push(buildConflict('sensitive_field_only_fix', [`student:${studentId}`, `crm:${contact.crm_id}`, `payment:${payment.fixture_record_id}`], ['crm', 'payments'], ['billing_owner_email'], { crm_billing_owner: contact.billing_owner_email, payment_payer: payment.payer_email }));
      }
    }
  }

  conflicts.sort((left, right) => left.conflict_key.localeCompare(right.conflict_key));
  return { conflicts, uncheckedRules };
}
