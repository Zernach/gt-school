import { publicEntitySummary } from '../domain/dashboard-reconciliation.js';
import type { FixtureSet } from '../domain/fixture-types.js';
import { resolveFixtureIdentities } from '../domain/identity.js';
import { normalizeEmail, normalizeName } from '../domain/normalization.js';
import { sha256 } from '../domain/stable.js';

export interface CanonicalProjection {
  id: string;
  entityKind: 'student' | 'lead' | 'unlinked_payment';
  displayName: string;
  resolutionStatus: 'linked' | 'unlinked';
  matchMethod: string;
  matchScoreBp: number;
  summary: Record<string, unknown>;
}

export interface ProjectionLink {
  canonicalId: string;
  sourceKind: 'crm' | 'app' | 'payments';
  entityKind: string;
  sourceId: string;
  matchMethod: string;
  matchScoreBp: number;
  evidence: Record<string, unknown>;
}

export interface HouseholdProjection {
  id: string;
  guardianEmailHash: string;
  members: string[];
}

export interface ProjectionResult {
  entities: CanonicalProjection[];
  links: ProjectionLink[];
  households: HouseholdProjection[];
}

export function buildCanonicalProjection(fixtures: FixtureSet): ProjectionResult {
  const { index, contactStudentIds, paymentStudentIds } = resolveFixtureIdentities(fixtures);
  const contactsByStudent = new Map<string, typeof fixtures.crmContacts>();
  for (const contact of fixtures.crmContacts) {
    const studentId = contactStudentIds.get(contact.crm_id);
    if (!studentId) continue;
    const group = contactsByStudent.get(studentId) ?? [];
    group.push(contact);
    contactsByStudent.set(studentId, group);
  }
  const paymentsByStudent = new Map<string, typeof fixtures.payments>();
  for (const payment of fixtures.payments) {
    const studentId = paymentStudentIds.get(payment.fixture_record_id);
    if (!studentId) continue;
    const group = paymentsByStudent.get(studentId) ?? [];
    group.push(payment);
    paymentsByStudent.set(studentId, group);
  }
  const enrollmentsByStudent = new Map(fixtures.appEnrollments.map((enrollment) => [enrollment.student_id, enrollment]));
  const contactsById = new Map(fixtures.crmContacts.map((contact) => [contact.crm_id, contact]));
  const dealsByStudent = new Map<string, typeof fixtures.crmDeals>();
  for (const deal of fixtures.crmDeals) {
    const studentIds = new Set(deal.associated_contact_ids.map((contactId) => contactStudentIds.get(contactId)).filter((id): id is string => Boolean(id)));
    for (const studentId of studentIds) {
      const group = dealsByStudent.get(studentId) ?? [];
      group.push(deal);
      dealsByStudent.set(studentId, group);
    }
  }
  const entities: CanonicalProjection[] = [];
  const links: ProjectionLink[] = [];
  const householdMembers = new Map<string, string[]>();
  for (const student of fixtures.appStudents) {
    const id = `entity:${student.id}`;
    const contacts = contactsByStudent.get(student.id) ?? [];
    const payments = paymentsByStudent.get(student.id) ?? [];
    const enrollment = enrollmentsByStudent.get(student.id);
    const deals = dealsByStudent.get(student.id) ?? [];
    const resolutionStatus = contacts.length > 0 || payments.length > 0 ? 'linked' : 'unlinked';
    entities.push({
      id,
      entityKind: 'student',
      displayName: `${student.first_name.trim()} ${student.last_name.trim()}`,
      resolutionStatus,
      matchMethod: contacts.some(({ external_id }) => external_id === student.id) || payments.some(({ external_ref }) => external_ref === student.id) ? 'hard_external_id' : resolutionStatus === 'linked' ? 'name_dob' : 'none',
      matchScoreBp: resolutionStatus === 'linked' ? 9000 : 0,
      summary: {
        student_id: student.id,
        registered: Boolean(enrollment),
        enrollment_stage: enrollment?.stage ?? null,
        paid: payments.some(({ status }) => status === 'paid'),
        payment_statuses: payments.map(({ status }) => status),
        crm_stage: deals[0]?.stage ?? null,
        crm_contact_ids: contacts.map(({ crm_id }) => crm_id),
        payment_ids: payments.map(({ fixture_record_id }) => fixture_record_id),
        raw: { app: student, crm: contacts, payments, enrollment, deals }
      }
    });
    links.push({ canonicalId: id, sourceKind: 'app', entityKind: 'student', sourceId: student.id, matchMethod: 'hard_external_id', matchScoreBp: 10_000, evidence: { source_primary_key: student.id } });
    if (enrollment) links.push({ canonicalId: id, sourceKind: 'app', entityKind: 'enrollment', sourceId: enrollment.id, matchMethod: 'hard_external_id', matchScoreBp: 10_000, evidence: { student_id: student.id } });
    for (const contact of contacts) {
      const resolution = index.resolveContact(contact);
      links.push({ canonicalId: id, sourceKind: 'crm', entityKind: 'contact', sourceId: contact.crm_id, matchMethod: resolution.method, matchScoreBp: resolution.scoreBp, evidence: resolution.evidence });
    }
    for (const payment of payments) {
      const resolution = index.resolvePayment(payment);
      links.push({ canonicalId: id, sourceKind: 'payments', entityKind: 'payment', sourceId: payment.fixture_record_id, matchMethod: resolution.method, matchScoreBp: resolution.scoreBp, evidence: resolution.evidence });
    }
    for (const deal of deals) links.push({ canonicalId: id, sourceKind: 'crm', entityKind: 'deal', sourceId: deal.deal_id, matchMethod: 'associated_contact', matchScoreBp: 9000, evidence: { associated_contact_ids: deal.associated_contact_ids } });
    if (student.household_id) {
      const members = householdMembers.get(student.household_id) ?? [];
      members.push(id);
      householdMembers.set(student.household_id, members);
    }
  }
  for (const contact of fixtures.crmContacts) {
    if (contactStudentIds.has(contact.crm_id)) continue;
    const id = `entity:crm:${contact.crm_id}`;
    entities.push({ id, entityKind: 'lead', displayName: `${contact.first_name} ${contact.last_name}`, resolutionStatus: 'unlinked', matchMethod: 'none', matchScoreBp: 0, summary: { crm_contact_ids: [contact.crm_id], raw: { crm: [contact] } } });
    links.push({ canonicalId: id, sourceKind: 'crm', entityKind: 'contact', sourceId: contact.crm_id, matchMethod: 'none', matchScoreBp: 0, evidence: {} });
  }
  for (const payment of fixtures.payments) {
    if (paymentStudentIds.has(payment.fixture_record_id)) continue;
    const id = `entity:payment:${payment.fixture_record_id}`;
    entities.push({ id, entityKind: 'unlinked_payment', displayName: payment.payer_name, resolutionStatus: 'unlinked', matchMethod: 'none', matchScoreBp: 0, summary: { payment_ids: [payment.fixture_record_id], raw: { payments: [payment] } } });
    links.push({ canonicalId: id, sourceKind: 'payments', entityKind: 'payment', sourceId: payment.fixture_record_id, matchMethod: 'none', matchScoreBp: 0, evidence: {} });
  }
  const households = [...householdMembers].map(([id, members]) => {
    const student = fixtures.appStudents.find(({ household_id }) => household_id === id);
    return { id, guardianEmailHash: sha256(normalizeEmail(student?.guardian_email ?? `${id}@example.test`).value), members };
  });
  void contactsById;
  entities.sort((left, right) => left.id.localeCompare(right.id));
  links.sort((left, right) => `${left.canonicalId}:${left.sourceKind}:${left.sourceId}`.localeCompare(`${right.canonicalId}:${right.sourceKind}:${right.sourceId}`));
  households.sort((left, right) => left.id.localeCompare(right.id));
  return { entities, links, households };
}

export function shapePublicEntityView(projection: ProjectionResult, entityId: string): Record<string, unknown> {
  const entity = projection.entities.find(({ id }) => id === entityId);
  if (!entity) throw new Error(`entity_view_missing:${entityId}`);
  const links = projection.links
    .filter(({ canonicalId }) => canonicalId === entityId)
    .map(({ sourceKind, entityKind, sourceId }) => ({ source_kind: sourceKind, entity_kind: entityKind, source_id: sourceId }))
    .sort((left, right) => `${left.source_kind}:${left.entity_kind}:${left.source_id}`.localeCompare(`${right.source_kind}:${right.entity_kind}:${right.source_id}`));
  return {
    entity_id: entity.id,
    display_name: entity.displayName,
    resolution_status: entity.resolutionStatus,
    match_method: entity.matchMethod,
    match_score_bp: entity.matchScoreBp,
    summary: publicEntitySummary(entity.summary),
    links
  };
}

export function normalizedDisplayName(firstName: string, lastName: string): string {
  return `${normalizeName(firstName).value} ${normalizeName(lastName).value}`;
}
