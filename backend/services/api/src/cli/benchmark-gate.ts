export interface BenchmarkTarget {
  pass: boolean;
}

export function allBenchmarkTargetsPassed(targets: Readonly<Record<string, BenchmarkTarget>>): boolean {
  return Object.values(targets).every(({ pass }) => pass);
}
