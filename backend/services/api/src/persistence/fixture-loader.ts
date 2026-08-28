import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePool } from './database.js';
import type { AppEnrollment, AppStudent } from '../domain/fixture-types.js';
import { sha256, stableStringify } from '../domain/stable.js';
import { loadFixtureSet } from '../fixtures/reader.js';

interface StudentRow {
  source_id: string;
  payload: AppStudent;
  payload_hash: string;
  observed_at: string;
}

interface EnrollmentRow {
  source_id: string;
  student_id: string;
  payload: AppEnrollment;
  payload_hash: string;
  observed_at: string;
}

async function insertBatches<T>(rows: readonly T[], size: number, insert: (batch: readonly T[]) => Promise<void>): Promise<void> {
  for (let index = 0; index < rows.length; index += size) await insert(rows.slice(index, index + size));
}

export async function loadAppSourceFixtures(pool: DatabasePool, fixtureRoot: string, seed: number): Promise<void> {
  const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8')) as unknown;
  // A fixture profile is authoritative for its synthetic seed. Removing rows
  // that no longer occur in a reduced profile prevents a prior larger local
  // seed from inflating the next sync or deployment verification.
  await pool.query('DELETE FROM source_app.enrollments WHERE seed = $1', [seed]);
  await pool.query('DELETE FROM source_app.students WHERE seed = $1', [seed]);
  for (const generation of [1, 2, 3]) {
    const fixtures = await loadFixtureSet(fixtureRoot, generation);
    const students: StudentRow[] = fixtures.appStudents.map((payload) => ({ source_id: payload.id, payload, payload_hash: sha256(stableStringify(payload)), observed_at: payload.updated_at }));
    const enrollments: EnrollmentRow[] = fixtures.appEnrollments.map((payload) => ({ source_id: payload.id, student_id: payload.student_id, payload, payload_hash: sha256(stableStringify(payload)), observed_at: payload.updated_at }));
    await insertBatches(students, 1000, async (batch) => {
      await pool.query(`INSERT INTO source_app.students(seed, generation, source_id, payload, payload_hash, observed_at)
        SELECT $1, $2, row.source_id, row.payload, row.payload_hash, row.observed_at::timestamptz
        FROM jsonb_to_recordset($3::jsonb) AS row(source_id text, payload jsonb, payload_hash text, observed_at text)
        ON CONFLICT (seed, generation, source_id) DO UPDATE SET payload = EXCLUDED.payload, payload_hash = EXCLUDED.payload_hash, observed_at = EXCLUDED.observed_at`, [seed, generation, JSON.stringify(batch)]);
    });
    await insertBatches(enrollments, 1000, async (batch) => {
      await pool.query(`INSERT INTO source_app.enrollments(seed, generation, source_id, student_id, payload, payload_hash, observed_at)
        SELECT $1, $2, row.source_id, row.student_id, row.payload, row.payload_hash, row.observed_at::timestamptz
        FROM jsonb_to_recordset($3::jsonb) AS row(source_id text, student_id text, payload jsonb, payload_hash text, observed_at text)
        ON CONFLICT (seed, generation, source_id) DO UPDATE SET student_id = EXCLUDED.student_id, payload = EXCLUDED.payload, payload_hash = EXCLUDED.payload_hash, observed_at = EXCLUDED.observed_at`, [seed, generation, JSON.stringify(batch)]);
    });
  }
  await pool.query(`INSERT INTO source_app.fixture_manifests(seed, manifest) VALUES ($1, $2::jsonb)
    ON CONFLICT (seed) DO UPDATE SET manifest = EXCLUDED.manifest, loaded_at = now()`, [seed, JSON.stringify(manifest)]);
}
