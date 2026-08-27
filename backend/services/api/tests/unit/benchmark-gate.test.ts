import { allBenchmarkTargetsPassed } from '../../src/cli/benchmark-gate.js';

describe('benchmark release gate', () => {
  it('passes only when every measured target meets its budget', () => {
    expect(allBenchmarkTargetsPassed({ entity: { pass: true }, dashboard: { pass: true } })).toBe(true);
    expect(allBenchmarkTargetsPassed({ entity: { pass: true }, dashboard: { pass: false } })).toBe(false);
  });
});
