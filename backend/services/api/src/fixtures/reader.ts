import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ZodType } from 'zod';
import {
  appEnrollmentSchema,
  appStudentSchema,
  crmContactSchema,
  crmDealSchema,
  paymentSchema,
  type AppEnrollment,
  type AppStudent,
  type CrmContact,
  type CrmDeal,
  type FixtureSet,
  type Payment
} from '../domain/fixture-types.js';
import { sha256 } from '../domain/stable.js';

export interface FixtureRejection {
  line: number;
  key: string;
  code: 'oversized_record' | 'malformed_json' | 'schema_invalid';
  detail: string;
  payloadHash: string;
}

export interface ReadResult<T> {
  records: T[];
  rejections: FixtureRejection[];
}

export async function readValidatedJsonl<T>(path: string, schema: ZodType<T>, maximumRecordBytes = 262_144): Promise<ReadResult<T>> {
  const records: T[] = [];
  const rejections: FixtureRejection[] = [];
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const payloadHash = sha256(line);
    if (Buffer.byteLength(line, 'utf8') > maximumRecordBytes) {
      rejections.push({ line: lineNumber, key: `line-${lineNumber}`, code: 'oversized_record', detail: `record exceeds ${maximumRecordBytes} bytes`, payloadHash });
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      rejections.push({ line: lineNumber, key: `line-${lineNumber}`, code: 'malformed_json', detail: 'record is not valid JSON', payloadHash });
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const key = typeof value === 'object' && value !== null && 'fixture_record_id' in value ? String((value as { fixture_record_id: unknown }).fixture_record_id) : `line-${lineNumber}`;
      rejections.push({ line: lineNumber, key, code: 'schema_invalid', detail: parsed.error.issues.map(({ path: issuePath, code }) => `${issuePath.join('.')}:${code}`).join(','), payloadHash });
      continue;
    }
    records.push(parsed.data);
  }
  return { records, rejections };
}

async function overlayByKey<T>(base: T[], deltas: readonly T[][], key: (record: T) => string): Promise<T[]> {
  const index = new Map(base.map((record) => [key(record), record]));
  for (const delta of deltas) for (const record of delta) index.set(key(record), record);
  return [...index.values()];
}

async function existingDelta<T>(path: string, schema: ZodType<T>): Promise<T[]> {
  try {
    await stat(path);
  } catch {
    return [];
  }
  const result = await readValidatedJsonl(path, schema);
  if (result.rejections.length > 0) throw new Error(`generated_delta_invalid:${path}`);
  return result.records;
}

export async function loadFixtureSet(root: string, generation = 3): Promise<FixtureSet> {
  if (!Number.isInteger(generation) || generation < 1 || generation > 3) throw new Error('fixture_generation_invalid');
  const [contactsResult, dealsResult, studentsResult, enrollmentsResult, paymentsResult] = await Promise.all([
    readValidatedJsonl(join(root, 'base', 'crm_contacts.jsonl'), crmContactSchema),
    readValidatedJsonl(join(root, 'base', 'crm_deals.jsonl'), crmDealSchema),
    readValidatedJsonl(join(root, 'base', 'app_students.jsonl'), appStudentSchema),
    readValidatedJsonl(join(root, 'base', 'app_enrollments.jsonl'), appEnrollmentSchema),
    readValidatedJsonl(join(root, 'base', 'payments.jsonl'), paymentSchema)
  ]);
  const baseRejections = [contactsResult, dealsResult, studentsResult, enrollmentsResult, paymentsResult].flatMap(({ rejections }) => rejections);
  if (baseRejections.length > 0) throw new Error(`generated_fixture_invalid:${baseRejections[0]?.detail ?? 'unknown'}`);
  const contactDeltas: CrmContact[][] = [];
  for (let current = 2; current <= generation; current += 1) {
    contactDeltas.push(await existingDelta(join(root, 'generations', String(current), 'crm_contacts.delta.jsonl'), crmContactSchema));
  }
  return {
    crmContacts: await overlayByKey(contactsResult.records as CrmContact[], contactDeltas, ({ crm_id }) => crm_id),
    crmDeals: dealsResult.records as CrmDeal[],
    appStudents: studentsResult.records as AppStudent[],
    appEnrollments: enrollmentsResult.records as AppEnrollment[],
    payments: paymentsResult.records as Payment[]
  };
}

export async function readMalformedFixture(root: string, maximumRecordBytes = 262_144): Promise<ReadResult<Payment>> {
  return readValidatedJsonl(join(root, 'malformed-payments.jsonl'), paymentSchema, maximumRecordBytes);
}
