import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import type { AppEnrollment, AppStudent, CrmContact, CrmDeal, GoldenConflict, Payment } from '../domain/fixture-types.js';
import { resolveFixtureIdentities } from '../domain/identity.js';
import { buildConflict } from '../domain/invariants.js';
import { normalizeEmail, timestampIsReversed } from '../domain/normalization.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';

export const CANONICAL_SEED = 424242;
export const REQUIRED_COUNTS = { crmContacts: 40_000, crmDeals: 15_000, appStudents: 25_000, appEnrollments: 22_000, payments: 18_000 } as const;

const FIRST_NAMES = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Asher', 'Harper', 'Quinn', 'Rowan', 'Sage', 'Emerson'];
const LAST_NAMES = ['Rivera', 'Patel', 'Nguyen', 'Johnson', 'Kim', 'Garcia', 'Brown', 'Singh', 'Williams', 'Chen'];

function pad(value: number, width = 5): string {
  return String(value).padStart(width, '0');
}

function studentId(seed: number, index: number): string {
  return stableUuid(`keystone:${seed}:student:${index}`);
}

function enrollmentId(seed: number, index: number): string {
  return stableUuid(`keystone:${seed}:enrollment:${index}`);
}

function personName(index: number): { first: string; last: string } {
  return { first: FIRST_NAMES[index % FIRST_NAMES.length] ?? 'Avery', last: LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length] ?? 'Rivera' };
}

function dirtyName(value: string, index: number, source: number): string {
  if ((index + source) % 131 === 0) return `\`${value}\``;
  if ((index + source) % 97 === 0) return `${value}  `;
  if ((index + source) % 83 === 0) return value.toLocaleUpperCase('en-US');
  return value;
}

function dateFor(index: number, hour = 12): string {
  const epoch = Date.UTC(2025, 0, 1, hour);
  return new Date(epoch + (index % 365) * 86_400_000).toISOString();
}

function updatedFor(index: number, created: string): string {
  return new Date(new Date(created).valueOf() + (index % 200 === 0 ? -86_400_000 : 3_600_000)).toISOString();
}

function dobFor(index: number): string {
  // A name repeats every 100 records, so advance the date on that same cycle.
  // The resulting name+DOB tuple is unique without inventing a universal ID.
  return new Date(Date.UTC(2012, 0, 1 + Math.floor(index / 100))).toISOString().slice(0, 10);
}

function householdId(index: number): string | undefined {
  return index < 3000 ? `household-${pad(Math.floor(index / 3), 4)}` : undefined;
}

function baseEmail(seed: number, index: number): string {
  const household = householdId(index);
  const local = household ? `${household}-${seed}` : `guardian-${seed}-${pad(index)}`;
  return index % 7 === 0 ? `${local.replaceAll('-', '')}@gmail.com` : `${local}@example.test`;
}

function emailVariant(email: string, index: number, source: 'crm' | 'app' | 'payments'): string {
  if (!email.endsWith('@gmail.com') || index % 89 !== 0) return source === 'crm' && index % 101 === 0 ? email.toLocaleUpperCase('en-US') : email;
  const [local] = email.split('@');
  if (source === 'crm') return `${local?.slice(0, 5)}.${local?.slice(5)}+crm@gmail.com`;
  if (source === 'payments') return `${local}+pay@googlemail.com`;
  return email;
}

function studentRef(seed: number, index: number): string {
  return `student:${studentId(seed, index)}`;
}

const C1 = new Set(Array.from({ length: 500 }, (_, index) => index));
const C6 = C1;
const C7 = new Set(Array.from({ length: 300 }, (_, index) => 500 + index));
const C8 = new Set(Array.from({ length: 150 }, (_, index) => 900 + index * 3));
const C9 = new Set(Array.from({ length: 100 }, (_, index) => 1400 + index));
const C10 = new Set(Array.from({ length: 50 }, (_, index) => 1550 + index));
const C11 = new Set(Array.from({ length: 50 }, (_, index) => 1650 + index));
const C12 = new Set(Array.from({ length: 100 }, (_, index) => 1750 + index));
const C13 = new Set(Array.from({ length: 100 }, (_, index) => 1850 + index));
const C14 = new Set(Array.from({ length: 50 }, (_, index) => 1950 + index));
const C3 = new Set(Array.from({ length: 300 }, (_, index) => 2100 + index));
const C4 = new Set(Array.from({ length: 250 }, (_, index) => 3000 + index));
const C5 = new Set(Array.from({ length: 400 }, (_, index) => 24_000 + index));

function makeStudent(seed: number, index: number): AppStudent {
  const name = personName(index);
  const createdAt = dateFor(index);
  const household = householdId(index);
  return {
    id: studentId(seed, index),
    first_name: dirtyName(name.first, index, 1),
    last_name: dirtyName(name.last, index, 2),
    dob: dobFor(index),
    grade: index % 3 === 0 ? `Grade ${index % 8}` : index % 8,
    guardian_email: emailVariant(baseEmail(seed, index), index, 'app'),
    guardian2_email: index % 5 < 3 ? null : `guardian2-${seed}-${pad(index)}@example.test`,
    status: C5.has(index) ? 'active_candidate' : 'active',
    enrollment_year: 2026,
    created_at: createdAt,
    updated_at: updatedFor(index, createdAt),
    ...(household ? { household_id: household } : {}),
    address_state: index % 3 === 0 ? 'TX' : index % 3 === 1 ? 'Tx' : 'TEXAS'
  };
}

function makeContact(seed: number, index: number, student: AppStudent): CrmContact {
  const createdAt = dateFor(index, 10);
  const externalId = index % 5 < 3 && !C4.has(index) ? student.id : undefined;
  const secondaryIndex = (index + 7000) % REQUIRED_COUNTS.appStudents;
  const secondaryName = personName(secondaryIndex);
  const intendedEmail = C4.has(index) ? `alternate-${seed}-${pad(index)}@example.test` : emailVariant(baseEmail(seed, index), index, 'crm');
  const contact: CrmContact = {
    crm_id: `crm-${seed}-${pad(index)}`,
    email: intendedEmail,
    first_name: dirtyName(personName(index).first, index, 3),
    last_name: dirtyName(personName(index).last, index, 4),
    lifecycle_stage: 'student',
    created_at: createdAt,
    updated_at: updatedFor(index, createdAt),
    dob: student.dob,
    grade: C6.has(index) ? (index % 8 + 1) % 8 : student.grade,
    role: 'student',
    billing_owner_email: C14.has(index) ? `other-owner-${seed}-${index}@example.test` : student.guardian_email,
    address_state: index % 3 === 0 ? 'texas' : 'TX',
    ...(student.household_id ? { household_id: student.household_id } : {}),
    ...(externalId ? { external_id: externalId } : {}),
    ...(C10.has(index) ? { secondary_person: { first_name: secondaryName.first, last_name: secondaryName.last, dob: dobFor(secondaryIndex), email: baseEmail(seed, secondaryIndex) } } : {})
  };
  return contact;
}

function makeEnrollment(seed: number, index: number, student: AppStudent): AppEnrollment {
  const createdAt = dateFor(index, 11);
  const noPayment = C7.has(index) || C8.has(index);
  const stage = C7.has(index) || C13.has(index) ? 'enrolled' : C8.has(index) ? 'applied' : 'registered';
  const normalDealId = index < 15_500 && !C1.has(index) ? `deal-${seed}-${pad(index)}` : null;
  return {
    id: enrollmentId(seed, index),
    student_id: student.id,
    program: 'Keystone Academy',
    stage,
    deposit_paid_at: noPayment ? null : dateFor(index, 13),
    crm_deal_id: C9.has(index) ? `missing-deal-${seed}-${pad(index)}` : normalDealId,
    created_at: createdAt,
    updated_at: updatedFor(index, createdAt)
  };
}

function makePayment(seed: number, index: number, student: AppStudent, suffix = 'primary'): Payment {
  const paymentId = `pay-${seed}-${pad(index)}`;
  const name = personName(index);
  const type = index < 15_500 ? 'deposit' : 'fee';
  return {
    fixture_record_id: `${paymentId}-${suffix}`,
    payment_id: paymentId,
    payer_email: emailVariant(baseEmail(seed, index), index, 'payments'),
    payer_name: `${name.first} ${name.last}`,
    amount_cents: C12.has(index) ? 100 : type === 'deposit' ? 50_000 : 10_000,
    currency: index % 31 === 0 ? 'USD' : 'usd',
    type,
    status: C13.has(index) ? 'refunded' : 'paid',
    occurred_at: dateFor(index, 13),
    ...(index % 5 < 3 ? { external_ref: student.id } : {}),
    student_name: `${name.first} ${name.last}`,
    student_dob: student.dob
  };
}

function makeGolden(seed: number, students: readonly AppStudent[], contactsByIndex: ReadonlyMap<number, CrmContact>, paymentsByIndex: ReadonlyMap<number, Payment>): GoldenConflict[] {
  const rows: GoldenConflict[] = [];
  const add = (base: ReturnType<typeof buildConflict>, cause: string): void => {
    rows.push({ ...base, cause_refs: [cause] });
  };
  for (const index of C1) {
    const payment = paymentsByIndex.get(index)!;
    add(buildConflict('paid_but_no_deal', [studentRef(seed, index), `payment:${payment.fixture_record_id}`], ['app', 'crm', 'payments'], ['crm_deal_id'], { payment_id: payment.payment_id, enrollment_id: enrollmentId(seed, index) }), 'C1');
  }
  for (let index = 0; index < 200; index += 1) {
    const recordId = `orphan-pay-${seed}-${pad(index)}`;
    add(buildConflict('payment_with_no_person', [`payment:${recordId}`], ['app', 'crm', 'payments'], ['person_link'], { payment_id: `orphan-payment-${seed}-${pad(index)}` }), 'C2');
  }
  for (const index of C3) {
    const base = contactsByIndex.get(index)!;
    add(buildConflict('duplicate_by_email', [`crm:${base.crm_id}`, `crm:${base.crm_id}-duplicate`], ['crm'], ['email'], { normalized_email: normalizeEmail(base.email).value }), 'C3');
  }
  for (const index of C4) {
    const student = students[index]!;
    const contact = contactsByIndex.get(index)!;
    add(buildConflict('cross_source_email_mismatch', [studentRef(seed, index), `crm:${contact.crm_id}`], ['app', 'crm'], ['email'], { app_email: normalizeEmail(student.guardian_email).value, crm_email: normalizeEmail(contact.email).value, identity: 'name_dob' }), 'C4');
  }
  for (const index of C5) add(buildConflict('required_source_missing', [studentRef(seed, index)], ['app', 'crm', 'payments'], ['source_presence'], { required: ['crm', 'payments'] }), 'C5');
  for (const index of C6) {
    const contact = contactsByIndex.get(index)!;
    add(buildConflict('material_field_disagreement', [studentRef(seed, index), `crm:${contact.crm_id}`], ['app', 'crm'], ['grade'], { app_grade: index % 8, crm_grade: (index % 8 + 1) % 8 }), 'C6');
  }
  for (const index of C7) add(buildConflict('enrolled_but_unpaid', [studentRef(seed, index), `enrollment:${enrollmentId(seed, index)}`], ['app', 'payments'], ['payment_id'], { stage: 'enrolled' }), 'C7');
  for (const index of C8) add(buildConflict('dropped_sibling', [studentRef(seed, index), `household:${householdId(index)}`], ['app', 'crm', 'payments'], ['household_member_payment'], { sibling_count: 3, missing_student_id: studentId(seed, index) }), 'C8');
  for (const index of C9) add(buildConflict('stale_crm_pointer', [studentRef(seed, index), `enrollment:${enrollmentId(seed, index)}`], ['app', 'crm'], ['crm_deal_id'], { crm_deal_id: `missing-deal-${seed}-${pad(index)}`, reason: 'missing' }), 'C9');
  for (const index of C10) add(buildConflict('merge_collapsed_record', [`crm:${contactsByIndex.get(index)!.crm_id}`], ['crm', 'app'], ['secondary_person'], { secondary_person: contactsByIndex.get(index)!.secondary_person }), 'C10');
  for (const index of C11) {
    const payment = paymentsByIndex.get(index)!;
    add(buildConflict('duplicate_payment', [`payment:${payment.fixture_record_id}`, `payment:${payment.payment_id}-duplicate`], ['payments'], ['payment_id'], { payment_id: payment.payment_id }), 'C11');
  }
  for (const index of C12) {
    const payment = paymentsByIndex.get(index)!;
    add(buildConflict('wrong_amount_payment', [`payment:${payment.fixture_record_id}`], ['payments'], ['amount_cents'], { actual: 100, expected: 50_000, currency: payment.currency }), 'C12');
  }
  for (const index of C13) {
    const payment = paymentsByIndex.get(index)!;
    add(buildConflict('refund_not_reflected', [studentRef(seed, index), `payment:${payment.fixture_record_id}`], ['app', 'payments'], ['deposit_paid_at', 'payment_status'], { payment_status: 'refunded', enrollment_stage: 'enrolled' }), 'C13');
  }
  for (const index of C14) {
    const contact = contactsByIndex.get(index)!;
    const payment = paymentsByIndex.get(index)!;
    add(buildConflict('sensitive_field_only_fix', [studentRef(seed, index), `crm:${contact.crm_id}`, `payment:${payment.fixture_record_id}`], ['crm', 'payments'], ['billing_owner_email'], { crm_billing_owner: contact.billing_owner_email, payment_payer: payment.payer_email }), 'C14');
  }
  return rows.sort((left, right) => left.conflict_key.localeCompare(right.conflict_key));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(value, 2)}\n`, 'utf8');
}

async function writeJsonl(path: string, records: readonly unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { encoding: 'utf8' });
  for (const record of records) {
    if (!stream.write(`${stableStringify(record)}\n`)) await once(stream, 'drain');
  }
  stream.end();
  await once(stream, 'finish');
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function validatePlan(fixtures: { contacts: CrmContact[]; deals: CrmDeal[]; students: AppStudent[]; enrollments: AppEnrollment[]; payments: Payment[]; golden: GoldenConflict[] }): Record<string, number> {
  const counts = { crmContacts: fixtures.contacts.length, crmDeals: fixtures.deals.length, appStudents: fixtures.students.length, appEnrollments: fixtures.enrollments.length, payments: fixtures.payments.length };
  for (const [key, expected] of Object.entries(REQUIRED_COUNTS)) if (counts[key as keyof typeof counts] !== expected) throw new Error(`fixture_count_mismatch:${key}`);
  const byType = new Map<string, number>();
  for (const conflict of fixtures.golden) byType.set(conflict.type, (byType.get(conflict.type) ?? 0) + 1);
  const minimums = [500, 200, 300, 250, 400, 500, 300, 150, 100, 50, 50, 100, 100, 50];
  const types = ['paid_but_no_deal','payment_with_no_person','duplicate_by_email','cross_source_email_mismatch','required_source_missing','material_field_disagreement','enrolled_but_unpaid','dropped_sibling','stale_crm_pointer','merge_collapsed_record','duplicate_payment','wrong_amount_payment','refund_not_reflected','sensitive_field_only_fix'];
  types.forEach((type, index) => { if ((byType.get(type) ?? 0) < (minimums[index] ?? Number.POSITIVE_INFINITY)) throw new Error(`conflict_minimum_missed:${type}`); });
  const conflictStudents = new Map<string, number>();
  for (const conflict of fixtures.golden) for (const ref of conflict.entity_refs.filter((item) => item.startsWith('student:'))) conflictStudents.set(ref, (conflictStudents.get(ref) ?? 0) + 1);
  const overlappingRows = fixtures.golden.filter((conflict) => conflict.entity_refs.some((ref) => (conflictStudents.get(ref) ?? 0) > 1)).length;
  if (overlappingRows / fixtures.golden.length < 0.1) throw new Error('conflict_overlap_below_10_percent');
  const identities = resolveFixtureIdentities({
    crmContacts: fixtures.contacts,
    crmDeals: fixtures.deals,
    appStudents: fixtures.students,
    appEnrollments: fixtures.enrollments,
    payments: fixtures.payments
  });
  const contactStudentIds = new Set(identities.contactStudentIds.values());
  const paymentStudentIds = new Set(identities.paymentStudentIds.values());
  const threeSource = fixtures.students.filter(({ id }) => contactStudentIds.has(id) && paymentStudentIds.has(id)).length;
  if (threeSource < 17_500) throw new Error(`three_source_ratio_missed:${threeSource}`);
  const reversedTimestamps = [...fixtures.students, ...fixtures.contacts].filter((record) => timestampIsReversed(record.created_at, record.updated_at)).length;
  const nullGuardian2 = fixtures.students.filter(({ guardian2_email }) => guardian2_email === null).length;
  if (nullGuardian2 !== 15_000) throw new Error(`guardian2_null_ratio_missed:${nullGuardian2}`);
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), goldenConflicts: fixtures.golden.length, overlappingConflictRows: overlappingRows, threeSourceStudents: threeSource, households: 1000, orphanLeads: fixtures.contacts.filter(({ role }) => role === 'lead').length, reassertedFields: 25, malformedRecords: 21, reversedTimestamps, cleanEntities: REQUIRED_COUNTS.appStudents - conflictStudents.size };
}

export interface GenerateOptions {
  seed?: number;
  outputRoot: string;
  goldenRoot: string;
}

export async function generateFixtures(options: GenerateOptions): Promise<Record<string, unknown>> {
  const seed = options.seed ?? CANONICAL_SEED;
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('seed_must_be_nonnegative_safe_integer');
  const temporaryRoot = `${options.outputRoot}.tmp-${process.pid}`;
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  const students = Array.from({ length: REQUIRED_COUNTS.appStudents }, (_, index) => makeStudent(seed, index));
  const enrollments = students.slice(0, REQUIRED_COUNTS.appEnrollments).map((student, index) => makeEnrollment(seed, index, student));
  const contacts: CrmContact[] = [];
  const contactsByIndex = new Map<number, CrmContact>();
  for (let index = 0; index < students.length; index += 1) {
    if (C5.has(index)) continue;
    const contact = makeContact(seed, index, students[index]!);
    contacts.push(contact);
    contactsByIndex.set(index, contact);
  }
  for (const index of C3) contacts.push({ ...contactsByIndex.get(index)!, crm_id: `${contactsByIndex.get(index)!.crm_id}-duplicate` });
  while (contacts.length < REQUIRED_COUNTS.crmContacts) {
    const leadIndex = contacts.length;
    const name = personName(leadIndex + 50_000);
    const createdAt = dateFor(leadIndex, 9);
    contacts.push({ crm_id: `lead-${seed}-${pad(leadIndex)}`, email: `lead-${seed}-${pad(leadIndex)}@example.test`, first_name: name.first, last_name: name.last, lifecycle_stage: 'lead', created_at: createdAt, updated_at: updatedFor(leadIndex, createdAt), role: 'lead' });
  }
  const deals: CrmDeal[] = [];
  for (let index = 0; index < 15_500; index += 1) {
    if (C1.has(index)) continue;
    const createdAt = dateFor(index, 11);
    deals.push({ deal_id: `deal-${seed}-${pad(index)}`, name: `Enrollment ${pad(index)}`, pipeline: 'admissions', stage: 'closed_won', amount: 50_000, associated_contact_ids: [`crm-${seed}-${pad(index)}`], created_at: createdAt, updated_at: updatedFor(index, createdAt) });
  }
  const payments: Payment[] = [];
  const paymentsByIndex = new Map<number, Payment>();
  for (let index = 0; index < 18_000; index += 1) {
    if (C7.has(index) || C8.has(index)) continue;
    const payment = makePayment(seed, index, students[index]!);
    payments.push(payment);
    paymentsByIndex.set(index, payment);
  }
  for (let index = 0; index < 200; index += 1) {
    payments.push({ fixture_record_id: `orphan-pay-${seed}-${pad(index)}`, payment_id: `orphan-payment-${seed}-${pad(index)}`, payer_email: `orphan-${seed}-${pad(index)}@example.test`, payer_name: `Orphan Fixture ${index}`, amount_cents: 50_000, currency: 'usd', type: 'deposit', status: 'paid', occurred_at: dateFor(index, 14) });
  }
  for (const index of C11) {
    const original = paymentsByIndex.get(index)!;
    payments.push({ ...original, fixture_record_id: `${original.payment_id}-duplicate` });
  }
  for (let index = 18_000; payments.length < REQUIRED_COUNTS.payments; index += 1) {
    const payment = makePayment(seed, index, students[index]!);
    payments.push(payment);
    paymentsByIndex.set(index, payment);
  }
  const golden = makeGolden(seed, students, contactsByIndex, paymentsByIndex);
  const metrics = validatePlan({ contacts, deals, students, enrollments, payments, golden });
  const files = {
    crmContacts: join(temporaryRoot, 'base', 'crm_contacts.jsonl'),
    crmDeals: join(temporaryRoot, 'base', 'crm_deals.jsonl'),
    appStudents: join(temporaryRoot, 'base', 'app_students.jsonl'),
    appEnrollments: join(temporaryRoot, 'base', 'app_enrollments.jsonl'),
    payments: join(temporaryRoot, 'base', 'payments.jsonl')
  };
  await Promise.all([
    writeJsonl(files.crmContacts, contacts),
    writeJsonl(files.crmDeals, deals),
    writeJsonl(files.appStudents, students),
    writeJsonl(files.appEnrollments, enrollments),
    writeJsonl(files.payments, payments)
  ]);
  const generation2 = [...C6].slice(0, 25).map((index) => ({ ...contactsByIndex.get(index)!, grade: students[index]!.grade }));
  const generation3 = [...C6].slice(0, 25).map((index) => contactsByIndex.get(index)!);
  await writeJsonl(join(temporaryRoot, 'generations', '2', 'crm_contacts.delta.jsonl'), generation2);
  await writeJsonl(join(temporaryRoot, 'generations', '3', 'crm_contacts.delta.jsonl'), generation3);
  for (const generation of [1, 2, 3]) {
    await writeJson(join(temporaryRoot, 'generations', String(generation), 'manifest.json'), {
      generation,
      sources: {
        crm: { base: 'base', deltas: generation >= 2 ? Array.from({ length: generation - 1 }, (_, index) => `generations/${index + 2}/crm_contacts.delta.jsonl`) : [] },
        app: { base: 'base', deltas: [] },
        payments: { base: 'base', deltas: [] }
      }
    });
  }
  const malformedLines: string[] = [];
  for (let index = 0; index < 7; index += 1) malformedLines.push(stableStringify({ fixture_record_id: `malformed-missing-${index}`, payer_email: `bad-${index}@example.test` }));
  for (let index = 0; index < 6; index += 1) malformedLines.push(stableStringify({ fixture_record_id: `malformed-type-${index}`, payment_id: index, amount_cents: 'fifty dollars' }));
  for (let index = 0; index < 7; index += 1) malformedLines.push(`{"fixture_record_id":"truncated-${index}",`);
  malformedLines.push(stableStringify({ fixture_record_id: 'oversized-0', payment_id: 'oversized', payload: 'x'.repeat(300_000) }));
  await writeFile(join(temporaryRoot, 'malformed-payments.jsonl'), `${malformedLines.join('\n')}\n`, 'utf8');
  const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await fileHash(path)])));
  const manifest = { schemaVersion: 'fixtures-v1', seed, generations: 3, files: Object.fromEntries(Object.entries(files).map(([key, path]) => [key, path.slice(temporaryRoot.length + 1)])), hashes, metrics };
  await writeJson(join(temporaryRoot, 'manifest.json'), manifest);
  await rm(options.outputRoot, { recursive: true, force: true });
  await rename(temporaryRoot, options.outputRoot);
  await mkdir(options.goldenRoot, { recursive: true });
  await writeJson(join(options.goldenRoot, 'conflicts.json'), golden);
  const conflictStudentIds = new Set(golden.flatMap(({ entity_refs }) => entity_refs.filter((ref) => ref.startsWith('student:')).map((ref) => ref.slice('student:'.length))));
  const cleanSample = students.filter(({ id }) => !conflictStudentIds.has(id)).slice(0, 1000).map((student) => ({ entity_ref: `student:${student.id}`, expected_conflicts: [], fixture_hash: sha256(stableStringify(student)) }));
  if (cleanSample.length !== 1000) throw new Error('clean_sample_too_small');
  await writeJson(join(options.goldenRoot, 'clean-sample.json'), cleanSample);
  const outputStats = await stat(join(options.outputRoot, 'manifest.json'));
  return { ...manifest, manifestBytes: outputStats.size };
}
