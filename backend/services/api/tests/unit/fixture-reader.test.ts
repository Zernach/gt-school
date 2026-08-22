import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paymentSchema } from '../../src/domain/fixture-types.js';
import { stableStringify } from '../../src/domain/stable.js';
import { loadFixtureSet, readMalformedFixture, readValidatedJsonl } from '../../src/fixtures/reader.js';
import { makeContact, makeDeal, makeEnrollment, makePayment, makeStudent } from '../helpers/fixtures.js';

let temporaryRoot = '';

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'keystone-reader-test-'));
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function writeLines(path: string, values: readonly unknown[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${values.map((value) => typeof value === 'string' ? value : stableStringify(value)).join('\n')}\n`, 'utf8');
}

async function writeMinimumFixtureRoot(root: string): Promise<void> {
  const student = makeStudent();
  await mkdir(join(root, 'base'), { recursive: true });
  await Promise.all([
    writeLines(join(root, 'base', 'crm_contacts.jsonl'), [makeContact(0, student)]),
    writeLines(join(root, 'base', 'crm_deals.jsonl'), [makeDeal()]),
    writeLines(join(root, 'base', 'app_students.jsonl'), [student]),
    writeLines(join(root, 'base', 'app_enrollments.jsonl'), [makeEnrollment(0, student)]),
    writeLines(join(root, 'base', 'payments.jsonl'), [makePayment(0, student)]),
    writeFile(join(root, 'manifest.json'), '{}\n', 'utf8')
  ]);
}

describe('streaming validated JSONL reader', () => {
  it('accepts every valid record in source order', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const first = makePayment(1);
    const second = makePayment(2);
    await writeLines(path, [first, second]);
    await expect(readValidatedJsonl(path, paymentSchema)).resolves.toEqual({ records: [first, second], rejections: [] });
  });

  it('supports CRLF input without retaining carriage returns', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const first = makePayment(1);
    const second = makePayment(2);
    await writeFile(path, `${stableStringify(first)}\r\n${stableStringify(second)}\r\n`, 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.records).toEqual([first, second]);
    expect(result.rejections).toEqual([]);
  });

  it('continues after malformed JSON and reports the exact line', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeLines(path, [makePayment(1), '{"fixture_record_id":"cut-off",', makePayment(2)]);
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.records).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({ line: 2, key: 'line-2', code: 'malformed_json', detail: 'record is not valid JSON' });
  });

  it('reports a blank line as malformed instead of silently skipping input', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeFile(path, `${stableStringify(makePayment())}\n\n`, 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.records).toHaveLength(1);
    expect(result.rejections).toEqual([expect.objectContaining({ line: 2, code: 'malformed_json' })]);
  });

  it('reports schema failures with the supplied fixture key', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeLines(path, [{ fixture_record_id: 'known-bad-key', payment_id: 42 }]);
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.records).toEqual([]);
    expect(result.rejections[0]).toMatchObject({ line: 1, key: 'known-bad-key', code: 'schema_invalid' });
    expect(result.rejections[0]?.detail).toContain('payment_id:invalid_type');
  });

  it('uses a line key when an invalid object has no fixture record ID', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeLines(path, [{ payment_id: 'missing-fixture-record-id' }]);
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.rejections[0]).toMatchObject({ line: 1, key: 'line-1', code: 'schema_invalid' });
  });

  it('uses a line key for non-object JSON', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeLines(path, ['null', '42', '"string"']);
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.rejections.map(({ key }) => key)).toEqual(['line-1', 'line-2', 'line-3']);
    expect(result.rejections.every(({ code }) => code === 'schema_invalid')).toBe(true);
  });

  it('rejects a record at one byte over the configured boundary', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const line = stableStringify(makePayment());
    await writeFile(path, `${line}\n`, 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema, Buffer.byteLength(line) - 1);
    expect(result.records).toEqual([]);
    expect(result.rejections[0]).toMatchObject({ code: 'oversized_record', detail: `record exceeds ${Buffer.byteLength(line) - 1} bytes` });
  });

  it('accepts a record exactly at the configured byte boundary', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const payment = makePayment();
    const line = stableStringify(payment);
    await writeFile(path, `${line}\n`, 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema, Buffer.byteLength(line));
    expect(result.records).toEqual([payment]);
    expect(result.rejections).toEqual([]);
  });

  it('checks the byte size before attempting JSON parsing', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    await writeFile(path, '{this is invalid and oversized}\n', 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema, 5);
    expect(result.rejections[0]?.code).toBe('oversized_record');
  });

  it('hashes rejected input for correlation without returning the payload', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const sensitiveLine = '{"payer_email":"synthetic@example.test"';
    await writeFile(path, `${sensitiveLine}\n`, 'utf8');
    const result = await readValidatedJsonl(path, paymentSchema);
    expect(result.rejections[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result.rejections)).not.toContain('synthetic@example.test');
  });

  it('gives the same input the same correlation hash', async () => {
    const firstPath = join(temporaryRoot, 'first.jsonl');
    const secondPath = join(temporaryRoot, 'second.jsonl');
    await writeFile(firstPath, '{bad\n', 'utf8');
    await writeFile(secondPath, '{bad\n', 'utf8');
    const first = await readValidatedJsonl(firstPath, paymentSchema);
    const second = await readValidatedJsonl(secondPath, paymentSchema);
    expect(first.rejections[0]?.payloadHash).toBe(second.rejections[0]?.payloadHash);
  });

  it('collects mixed rejection types without losing later valid records', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const tooLarge = stableStringify({ fixture_record_id: 'large', payload: 'x'.repeat(600) });
    await writeLines(path, [
      '{broken',
      { fixture_record_id: 'schema-bad', payment_id: 123 },
      tooLarge,
      makePayment(4)
    ]);
    const result = await readValidatedJsonl(path, paymentSchema, 500);
    expect(result.records).toEqual([makePayment(4)]);
    expect(result.rejections.map(({ code }) => code)).toEqual(['malformed_json', 'schema_invalid', 'oversized_record']);
    expect(result.rejections.map(({ line }) => line)).toEqual([1, 2, 3]);
  });

  it('rejects when the input file does not exist', async () => {
    await expect(readValidatedJsonl(join(temporaryRoot, 'absent.jsonl'), paymentSchema)).rejects.toThrow(/ENOENT/u);
  });

  it('does not mutate accepted source objects', async () => {
    const path = join(temporaryRoot, 'payments.jsonl');
    const source = makePayment();
    const before = structuredClone(source);
    await writeLines(path, [source]);
    await readValidatedJsonl(path, paymentSchema);
    expect(source).toEqual(before);
  });
});

describe('fixture generation overlays', () => {
  it('loads generation one from base files', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    const fixtures = await loadFixtureSet(temporaryRoot, 1);
    expect(fixtures.crmContacts).toEqual([makeContact()]);
    expect(fixtures.crmDeals).toEqual([makeDeal()]);
    expect(fixtures.appStudents).toEqual([makeStudent()]);
    expect(fixtures.appEnrollments).toEqual([makeEnrollment()]);
    expect(fixtures.payments).toEqual([makePayment()]);
  });

  it('uses generation three by default', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await mkdir(join(temporaryRoot, 'generations', '3'), { recursive: true });
    await writeLines(join(temporaryRoot, 'generations', '3', 'crm_contacts.delta.jsonl'), [makeContact(0, makeStudent(), { grade: 7 })]);
    expect((await loadFixtureSet(temporaryRoot)).crmContacts[0]?.grade).toBe(7);
  });

  it('copy-on-write overlays a matching CRM source key', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await mkdir(join(temporaryRoot, 'generations', '2'), { recursive: true });
    const changed = makeContact(0, makeStudent(), { lifecycle_stage: 'reasserted' });
    await writeLines(join(temporaryRoot, 'generations', '2', 'crm_contacts.delta.jsonl'), [changed]);
    expect((await loadFixtureSet(temporaryRoot, 1)).crmContacts[0]?.lifecycle_stage).toBe('student');
    expect((await loadFixtureSet(temporaryRoot, 2)).crmContacts[0]?.lifecycle_stage).toBe('reasserted');
  });

  it('applies deltas in generation order with the newest value winning', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await mkdir(join(temporaryRoot, 'generations', '2'), { recursive: true });
    await mkdir(join(temporaryRoot, 'generations', '3'), { recursive: true });
    await writeLines(join(temporaryRoot, 'generations', '2', 'crm_contacts.delta.jsonl'), [makeContact(0, makeStudent(), { grade: 5 })]);
    await writeLines(join(temporaryRoot, 'generations', '3', 'crm_contacts.delta.jsonl'), [makeContact(0, makeStudent(), { grade: 6 })]);
    expect((await loadFixtureSet(temporaryRoot, 2)).crmContacts[0]?.grade).toBe(5);
    expect((await loadFixtureSet(temporaryRoot, 3)).crmContacts[0]?.grade).toBe(6);
  });

  it('adds a new delta key after the base rows in insertion order', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await mkdir(join(temporaryRoot, 'generations', '2'), { recursive: true });
    await writeLines(join(temporaryRoot, 'generations', '2', 'crm_contacts.delta.jsonl'), [makeContact(9)]);
    const contacts = (await loadFixtureSet(temporaryRoot, 2)).crmContacts;
    expect(contacts.map(({ crm_id }) => crm_id)).toEqual(['crm-0', 'crm-9']);
  });

  it('treats an absent delta file as an empty copy-on-write generation', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await expect(loadFixtureSet(temporaryRoot, 3)).resolves.toEqual(await loadFixtureSet(temporaryRoot, 1));
  });

  it.each([0, -1, 4, 1.5, Number.NaN])('rejects unsupported generation %j', async (generation) => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await expect(loadFixtureSet(temporaryRoot, generation)).rejects.toThrow('fixture_generation_invalid');
  });

  it('fails closed when any base file contains a rejection', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await writeFile(join(temporaryRoot, 'base', 'payments.jsonl'), '{broken\n', 'utf8');
    await expect(loadFixtureSet(temporaryRoot, 1)).rejects.toThrow('generated_fixture_invalid:record is not valid JSON');
  });

  it('fails closed when a generation delta is malformed', async () => {
    await writeMinimumFixtureRoot(temporaryRoot);
    await mkdir(join(temporaryRoot, 'generations', '2'), { recursive: true });
    const delta = join(temporaryRoot, 'generations', '2', 'crm_contacts.delta.jsonl');
    await writeFile(delta, '{broken\n', 'utf8');
    await expect(loadFixtureSet(temporaryRoot, 2)).rejects.toThrow(`generated_delta_invalid:${delta}`);
  });
});

describe('committed malformed fixture path', () => {
  it('routes malformed payment records through the same validator', async () => {
    await writeLines(join(temporaryRoot, 'malformed-payments.jsonl'), [
      makePayment(),
      { fixture_record_id: 'bad-payment', payment_id: 1 },
      '{truncated'
    ]);
    const result = await readMalformedFixture(temporaryRoot);
    expect(result.records).toEqual([makePayment()]);
    expect(result.rejections.map(({ code }) => code)).toEqual(['schema_invalid', 'malformed_json']);
  });

  it('honors the supplied body boundary for malformed fixtures', async () => {
    const value = makePayment();
    await writeLines(join(temporaryRoot, 'malformed-payments.jsonl'), [value]);
    const actualBytes = Buffer.byteLength(stableStringify(value));
    expect((await readMalformedFixture(temporaryRoot, actualBytes - 1)).rejections[0]?.code).toBe('oversized_record');
  });

  it('leaves fixture bytes unchanged after validation', async () => {
    const path = join(temporaryRoot, 'malformed-payments.jsonl');
    await writeLines(path, [makePayment()]);
    const before = await readFile(path, 'utf8');
    await readMalformedFixture(temporaryRoot);
    expect(await readFile(path, 'utf8')).toBe(before);
  });
});
