import type { AppStudent, CrmContact, FixtureSet, Payment } from './fixture-types.js';
import { normalizeEmail, normalizeName } from './normalization.js';

export interface IdentityResolution {
  status: 'linked' | 'ambiguous' | 'unlinked';
  student?: AppStudent;
  method: 'hard_external_id' | 'exact_email' | 'gmail_alias' | 'name_dob' | 'ambiguous' | 'none';
  scoreBp: number;
  evidence: Record<string, unknown>;
}

function nameDobKey(firstName: string, lastName: string, dob: string): string {
  return `${normalizeName(firstName).value}|${normalizeName(lastName).value}|${dob}`;
}

export class IdentityIndex {
  readonly #studentsById = new Map<string, AppStudent>();
  readonly #studentsByEmail = new Map<string, AppStudent[]>();
  readonly #studentsByNameDob = new Map<string, AppStudent[]>();

  constructor(students: readonly AppStudent[]) {
    for (const student of students) {
      this.#studentsById.set(student.id, student);
      const email = normalizeEmail(student.guardian_email).value;
      const emailMatches = this.#studentsByEmail.get(email) ?? [];
      emailMatches.push(student);
      this.#studentsByEmail.set(email, emailMatches);
      const key = nameDobKey(student.first_name, student.last_name, student.dob);
      const nameMatches = this.#studentsByNameDob.get(key) ?? [];
      nameMatches.push(student);
      this.#studentsByNameDob.set(key, nameMatches);
    }
  }

  resolveContact(contact: CrmContact): IdentityResolution {
    if (contact.external_id) {
      const student = this.#studentsById.get(contact.external_id);
      if (student) return { status: 'linked', student, method: 'hard_external_id', scoreBp: 10_000, evidence: { external_id: contact.external_id } };
    }
    if (contact.dob) {
      const candidates = this.#studentsByNameDob.get(nameDobKey(contact.first_name, contact.last_name, contact.dob)) ?? [];
      if (candidates.length === 1) return { status: 'linked', student: candidates[0]!, method: 'name_dob', scoreBp: 9000, evidence: { dob: contact.dob } };
      if (candidates.length > 1) return { status: 'ambiguous', method: 'ambiguous', scoreBp: 0, evidence: { candidates: candidates.map(({ id }) => id) } };
    }
    const normalized = normalizeEmail(contact.email);
    const candidates = this.#studentsByEmail.get(normalized.value) ?? [];
    if (candidates.length === 1) {
      const method = normalized.trace.some((item) => item.startsWith('gmail_')) ? 'gmail_alias' : 'exact_email';
      return { status: 'linked', student: candidates[0]!, method, scoreBp: method === 'exact_email' ? 9500 : 9250, evidence: { email: normalized.value } };
    }
    if (candidates.length > 1) return { status: 'ambiguous', method: 'ambiguous', scoreBp: 0, evidence: { candidates: candidates.map(({ id }) => id) } };
    return { status: 'unlinked', method: 'none', scoreBp: 0, evidence: {} };
  }

  resolvePayment(payment: Payment): IdentityResolution {
    if (payment.external_ref) {
      const student = this.#studentsById.get(payment.external_ref);
      if (student) return { status: 'linked', student, method: 'hard_external_id', scoreBp: 10_000, evidence: { external_ref: payment.external_ref } };
    }
    if (payment.student_name && payment.student_dob) {
      const split = payment.student_name.trim().split(/\s+/u);
      const firstName = split.shift() ?? '';
      const lastName = split.join(' ');
      const candidates = this.#studentsByNameDob.get(nameDobKey(firstName, lastName, payment.student_dob)) ?? [];
      if (candidates.length === 1) return { status: 'linked', student: candidates[0]!, method: 'name_dob', scoreBp: 9000, evidence: { dob: payment.student_dob } };
      if (candidates.length > 1) return { status: 'ambiguous', method: 'ambiguous', scoreBp: 0, evidence: { candidates: candidates.map(({ id }) => id) } };
    }
    const normalized = normalizeEmail(payment.payer_email);
    const candidates = this.#studentsByEmail.get(normalized.value) ?? [];
    if (candidates.length === 1) return { status: 'linked', student: candidates[0]!, method: 'exact_email', scoreBp: 9500, evidence: { email: normalized.value } };
    if (candidates.length > 1) return { status: 'ambiguous', method: 'ambiguous', scoreBp: 0, evidence: { candidates: candidates.map(({ id }) => id) } };
    return { status: 'unlinked', method: 'none', scoreBp: 0, evidence: {} };
  }
}

export function resolveFixtureIdentities(fixtures: FixtureSet): {
  index: IdentityIndex;
  contactStudentIds: Map<string, string>;
  paymentStudentIds: Map<string, string>;
} {
  const index = new IdentityIndex(fixtures.appStudents);
  const contactStudentIds = new Map<string, string>();
  const paymentStudentIds = new Map<string, string>();
  for (const contact of fixtures.crmContacts) {
    const resolution = index.resolveContact(contact);
    if (resolution.status === 'linked' && resolution.student) contactStudentIds.set(contact.crm_id, resolution.student.id);
  }
  for (const payment of fixtures.payments) {
    const resolution = index.resolvePayment(payment);
    if (resolution.status === 'linked' && resolution.student) paymentStudentIds.set(payment.fixture_record_id, resolution.student.id);
  }
  return { index, contactStudentIds, paymentStudentIds };
}
