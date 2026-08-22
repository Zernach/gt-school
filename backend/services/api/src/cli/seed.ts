import { resolve } from 'node:path';
import { CANONICAL_SEED, generateFixtures } from '../fixtures/generator.js';

function parseSeed(argv: readonly string[]): number {
  const index = argv.indexOf('--seed');
  if (index === -1) return CANONICAL_SEED;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('--seed requires a non-negative safe integer');
  return value;
}

const seed = parseSeed(process.argv.slice(2));
const repositoryRoot = resolve(import.meta.dirname, '../../../../../');
const manifest = await generateFixtures({
  seed,
  outputRoot: resolve(repositoryRoot, 'fixtures/generated'),
  goldenRoot: resolve(repositoryRoot, 'golden')
});
process.stdout.write(`${JSON.stringify({ status: 'generated', ...manifest })}\n`);
