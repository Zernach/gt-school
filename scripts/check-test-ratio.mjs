import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const repositoryRoot = process.cwd();
const sourceRoots = [
  join(repositoryRoot, 'backend/cloudflare/src'),
  join(repositoryRoot, 'backend/services/api/src'),
  join(repositoryRoot, 'frontend/src'),
  join(repositoryRoot, 'frontend/functions')
];
const testRoots = [
  join(repositoryRoot, 'backend/cloudflare/src'),
  join(repositoryRoot, 'backend/services/api/tests'),
  join(repositoryRoot, 'frontend/src'),
  join(repositoryRoot, 'e2e')
];
const sourceExtensions = new Set(['.ts', '.tsx']);

async function filesBelow(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isTestFile(path) {
  return /(?:^|\/)(?:tests?|e2e)(?:\/|$)/u.test(path)
    || /\.(?:test|spec)\.(?:ts|tsx)$/u.test(path);
}

async function countNonblankLines(paths) {
  let lines = 0;
  for (const path of paths) {
    const contents = await readFile(path, 'utf8');
    lines += contents.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  }
  return lines;
}

const productionFiles = (await Promise.all(sourceRoots.map(filesBelow)))
  .flat()
  .filter((path) => sourceExtensions.has(extname(path)))
  .filter((path) => !isTestFile(relative(repositoryRoot, path)))
  .filter((path) => !path.endsWith('vite-env.d.ts'))
  .filter((path) => !path.endsWith('worker-configuration.d.ts'));

const testFiles = [...new Set((await Promise.all(testRoots.map(filesBelow)))
  .flat()
  .filter((path) => sourceExtensions.has(extname(path)))
  .filter((path) => isTestFile(relative(repositoryRoot, path))))];

const [productionLines, testLines] = await Promise.all([
  countNonblankLines(productionFiles),
  countNonblankLines(testFiles)
]);
const ratio = productionLines === 0 ? Number.POSITIVE_INFINITY : testLines / productionLines;
const scorecard = {
  productionFiles: productionFiles.length,
  productionNonblankLines: productionLines,
  testFiles: testFiles.length,
  testNonblankLines: testLines,
  testToProductionRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(3)) : 'infinite',
  gate: 'test lines must be strictly greater than production lines'
};

console.log(JSON.stringify(scorecard, null, 2));
if (testLines <= productionLines) {
  console.error(`test_ratio_failed: ${testLines} test lines must exceed ${productionLines} production lines`);
  process.exitCode = 1;
}
