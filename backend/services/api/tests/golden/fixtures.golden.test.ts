import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GoldenConflict } from '../../src/domain/fixture-types.js';
import { conflictTypes } from '../../src/domain/fixture-types.js';
import { evaluateInvariants } from '../../src/domain/invariants.js';
import { CANONICAL_SEED, FIXTURE_PROFILE, generateFixtures, REQUIRED_COUNTS } from '../../src/fixtures/generator.js';
import { loadFixtureSet, readMalformedFixture } from '../../src/fixtures/reader.js';
import { buildCanonicalProjection, shapePublicEntityView } from '../../src/ingestion/projection.js';

const committedGoldenRoot = resolve(import.meta.dirname, '../../../../../golden');

let workspace = '';
let fixtureRoot = '';
let goldenRoot = '';
let manifest: Record<string, unknown>;
let golden: GoldenConflict[];

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'keystone-golden-test-'));
  fixtureRoot = join(workspace, 'fixtures');
  goldenRoot = join(workspace, 'golden');
  manifest = await generateFixtures({ seed: CANONICAL_SEED, outputRoot: fixtureRoot, goldenRoot });
  golden = JSON.parse(await readFile(join(goldenRoot, 'conflicts.json'), 'utf8')) as GoldenConflict[];
}, 30_000);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('canonical generator manifest', () => {
  it('records the canonical seed and versioned three-generation contract', () => {
    expect(manifest).toMatchObject({ schemaVersion: 'fixtures-v1', fixtureProfile: FIXTURE_PROFILE, seed: 424242, generations: 3 });
  });

  it('produces exactly the normative 12,000-record demo slice', () => {
    expect(manifest.metrics).toMatchObject({
      crmContacts: REQUIRED_COUNTS.crmContacts,
      crmDeals: REQUIRED_COUNTS.crmDeals,
      appStudents: REQUIRED_COUNTS.appStudents,
      appEnrollments: REQUIRED_COUNTS.appEnrollments,
      payments: REQUIRED_COUNTS.payments,
      total: 12_000
    });
  });

  it('meets the household, lead-noise, reassertion, and malformed minima', () => {
    expect(manifest.metrics).toMatchObject({
      households: 100,
      orphanLeads: 1_510,
      reassertedFields: 3,
      malformedRecords: 21
    });
  });

  it('places at least 70 percent of students in all three sources', () => {
    const metrics = manifest.metrics as { threeSourceStudents: number };
    expect(metrics.threeSourceStudents).toBeGreaterThanOrEqual(1_750);
    expect(metrics.threeSourceStudents / REQUIRED_COUNTS.appStudents).toBeGreaterThanOrEqual(0.7);
  });

  it('keeps at least 85 percent of app entities clean', () => {
    const metrics = manifest.metrics as { cleanEntities: number };
    expect(metrics.cleanEntities / REQUIRED_COUNTS.appStudents).toBeGreaterThanOrEqual(0.85);
  });

  it('plants overlapping causes in at least ten percent of golden rows', () => {
    const metrics = manifest.metrics as { overlappingConflictRows: number; goldenConflicts: number };
    expect(metrics.overlappingConflictRows / metrics.goldenConflicts).toBeGreaterThanOrEqual(0.1);
  });

  it('records a SHA-256 digest for every base source file', () => {
    const hashes = manifest.hashes as Record<string, string>;
    expect(Object.keys(hashes).sort()).toEqual(['appEnrollments', 'appStudents', 'crmContacts', 'crmDeals', 'payments']);
    expect(Object.values(hashes).every((hash) => /^[0-9a-f]{64}$/u.test(hash))).toBe(true);
  });

  it('records only relative fixture paths in the committed manifest', () => {
    const files = manifest.files as Record<string, string>;
    expect(Object.values(files).every((path) => path.startsWith('base/') && !path.startsWith('/'))).toBe(true);
  });
});

describe('mandated conflict distribution', () => {
  const minimums: Record<string, number> = {
    paid_but_no_deal: 50,
    payment_with_no_person: 20,
    duplicate_by_email: 30,
    cross_source_email_mismatch: 25,
    required_source_missing: 40,
    material_field_disagreement: 50,
    enrolled_but_unpaid: 30,
    dropped_sibling: 15,
    stale_crm_pointer: 10,
    merge_collapsed_record: 5,
    duplicate_payment: 5,
    wrong_amount_payment: 10,
    refund_not_reflected: 10,
    sensitive_field_only_fix: 5
  };

  it('exports all and only C1-C14 conflict types', () => {
    expect([...new Set(golden.map(({ type }) => type))].sort()).toEqual([...conflictTypes].sort());
  });

  it.each(conflictTypes)('meets the %s minimum', (type) => {
    expect(golden.filter((row) => row.type === type)).toHaveLength(minimums[type]!);
  });

  it('exports exactly 305 planted conflict rows', () => {
    expect(golden).toHaveLength(305);
  });

  it('uses a stable unique key for every planted verdict', () => {
    expect(new Set(golden.map(({ conflict_key }) => conflict_key)).size).toBe(golden.length);
    expect(golden.every(({ conflict_key }) => /^conflict_[0-9a-f]{24}$/u.test(conflict_key))).toBe(true);
  });

  it('tags every row with exactly one C1-C14 cause reference', () => {
    expect(golden.every(({ cause_refs }) => cause_refs.length === 1 && /^C(?:[1-9]|1[0-4])$/u.test(cause_refs[0] ?? ''))).toBe(true);
  });

  it('exports a deterministic fail verdict and complete evidence shape', () => {
    for (const row of golden) {
      expect(row.expected_verdict).toBe('fail');
      expect(row.rule_version).toBe('1.0.0');
      expect(row.entity_refs.length).toBeGreaterThan(0);
      expect(row.sources_involved.length).toBeGreaterThan(0);
      expect(row.disagreeing_fields.length).toBeGreaterThan(0);
      expect(row.evidence).toBeTypeOf('object');
    }
  });
});

describe('golden invariant scorecard', () => {
  it('matches every planted conflict 1:1 with zero false negatives or positives', async () => {
    const fixtures = await loadFixtureSet(fixtureRoot, 3);
    const detected = evaluateInvariants(fixtures).conflicts;
    const expected = golden.map(({ cause_refs: causeRefs, ...conflict }) => {
      void causeRefs;
      return conflict;
    });
    expect(detected).toEqual(expected);
    expect({
      expected: expected.length,
      detected: detected.length,
      falseNegatives: expected.filter((row) => !detected.some(({ conflict_key }) => conflict_key === row.conflict_key)).length,
      falsePositives: detected.filter((row) => !expected.some(({ conflict_key }) => conflict_key === row.conflict_key)).length
    }).toEqual({ expected: 305, detected: 305, falseNegatives: 0, falsePositives: 0 });
  }, 30_000);

  it('keeps every committed clean-sample entity conflict-free', async () => {
    const fixtures = await loadFixtureSet(fixtureRoot, 3);
    const conflicts = evaluateInvariants(fixtures).conflicts;
    const conflictRefs = new Set(conflicts.flatMap(({ entity_refs }) => entity_refs));
    const cleanSample = JSON.parse(await readFile(join(goldenRoot, 'clean-sample.json'), 'utf8')) as Array<{ entity_ref: string; expected_conflicts: unknown[]; fixture_hash: string }>;
    expect(cleanSample).toHaveLength(100);
    expect(cleanSample.every(({ entity_ref }) => !conflictRefs.has(entity_ref))).toBe(true);
    expect(cleanSample.every(({ expected_conflicts }) => expected_conflicts.length === 0)).toBe(true);
    expect(cleanSample.every(({ fixture_hash }) => /^[0-9a-f]{64}$/u.test(fixture_hash))).toBe(true);
  }, 30_000);

  it('never flags the 1,510 legitimate deal-less CRM leads as paid-but-no-deal', async () => {
    const fixtures = await loadFixtureSet(fixtureRoot, 3);
    const leadRefs = new Set(fixtures.crmContacts.filter(({ role }) => role === 'lead').map(({ crm_id }) => `crm:${crm_id}`));
    const paidWithoutDeal = evaluateInvariants(fixtures).conflicts.filter(({ type }) => type === 'paid_but_no_deal');
    expect(paidWithoutDeal).toHaveLength(50);
    expect(paidWithoutDeal.some(({ entity_refs }) => entity_refs.some((ref) => leadRefs.has(ref)))).toBe(false);
  }, 30_000);

  it('matches the committed golden oracles byte-for-byte', async () => {
    expect(await readFile(join(goldenRoot, 'conflicts.json'), 'utf8')).toBe(await readFile(join(committedGoldenRoot, 'conflicts.json'), 'utf8'));
    expect(await readFile(join(goldenRoot, 'clean-sample.json'), 'utf8')).toBe(await readFile(join(committedGoldenRoot, 'clean-sample.json'), 'utf8'));
    expect(await readFile(join(goldenRoot, 'entity-view.json'), 'utf8')).toBe(await readFile(join(committedGoldenRoot, 'entity-view.json'), 'utf8'));
  });

  it('projects the committed entity-view from raw fixtures without internal raw payloads', async () => {
    const fixtures = await loadFixtureSet(fixtureRoot, 3);
    const committed = JSON.parse(await readFile(join(committedGoldenRoot, 'entity-view.json'), 'utf8')) as { entity_id: string };
    const view = shapePublicEntityView(buildCanonicalProjection(fixtures), committed.entity_id);
    expect(view).toEqual(JSON.parse(await readFile(join(committedGoldenRoot, 'entity-view.json'), 'utf8')));
    expect(view).not.toHaveProperty('summary.raw');
  }, 30_000);
});

describe('adversarial generations', () => {
  it('temporarily removes exactly three grade conflicts in generation two', async () => {
    const generationOne = evaluateInvariants(await loadFixtureSet(fixtureRoot, 1)).conflicts;
    const generationTwo = evaluateInvariants(await loadFixtureSet(fixtureRoot, 2)).conflicts;
    const generationOneGrade = generationOne.filter(({ type }) => type === 'material_field_disagreement');
    const generationTwoGrade = generationTwo.filter(({ type }) => type === 'material_field_disagreement');
    expect(generationOneGrade).toHaveLength(50);
    expect(generationTwoGrade).toHaveLength(47);
    expect(generationOneGrade.filter(({ conflict_key }) => !generationTwoGrade.some((row) => row.conflict_key === conflict_key))).toHaveLength(3);
  }, 30_000);

  it('reasserts all three stale grade values in generation three', async () => {
    const generationTwo = evaluateInvariants(await loadFixtureSet(fixtureRoot, 2)).conflicts;
    const generationThree = evaluateInvariants(await loadFixtureSet(fixtureRoot, 3)).conflicts;
    const generationTwoKeys = new Set(generationTwo.map(({ conflict_key }) => conflict_key));
    const reasserted = generationThree.filter(({ type, conflict_key }) => type === 'material_field_disagreement' && !generationTwoKeys.has(conflict_key));
    expect(reasserted).toHaveLength(3);
  }, 30_000);
});

describe('malformed adapter input', () => {
  it('rejects all 21 malformed records without accepting one', async () => {
    const result = await readMalformedFixture(fixtureRoot);
    expect(result.records).toEqual([]);
    expect(result.rejections).toHaveLength(21);
  });

  it('classifies seven missing-shape, six wrong-type, seven truncated, and one oversized record', async () => {
    const result = await readMalformedFixture(fixtureRoot);
    expect(result.rejections.filter(({ code }) => code === 'schema_invalid')).toHaveLength(13);
    expect(result.rejections.filter(({ code }) => code === 'malformed_json')).toHaveLength(7);
    expect(result.rejections.filter(({ code }) => code === 'oversized_record')).toHaveLength(1);
  });

  it('never retains malformed raw bodies in rejection metadata', async () => {
    const result = await readMalformedFixture(fixtureRoot);
    expect(result.rejections.every(({ payloadHash }) => /^[0-9a-f]{64}$/u.test(payloadHash))).toBe(true);
    expect(JSON.stringify(result.rejections)).not.toContain('x'.repeat(100));
  });
});

describe('byte-for-byte determinism', () => {
  it('regenerates identical manifests and golden exports from the same seed', async () => {
    const secondFixtureRoot = join(workspace, 'fixtures-second');
    const secondGoldenRoot = join(workspace, 'golden-second');
    const secondManifest = await generateFixtures({ seed: CANONICAL_SEED, outputRoot: secondFixtureRoot, goldenRoot: secondGoldenRoot });
    expect(secondManifest.hashes).toEqual(manifest.hashes);
    expect(secondManifest.metrics).toEqual(manifest.metrics);
    expect(await readFile(join(secondGoldenRoot, 'conflicts.json'), 'utf8')).toBe(await readFile(join(goldenRoot, 'conflicts.json'), 'utf8'));
    expect(await readFile(join(secondGoldenRoot, 'clean-sample.json'), 'utf8')).toBe(await readFile(join(goldenRoot, 'clean-sample.json'), 'utf8'));
    expect(await readFile(join(secondGoldenRoot, 'entity-view.json'), 'utf8')).toBe(await readFile(join(goldenRoot, 'entity-view.json'), 'utf8'));
  }, 30_000);
});
