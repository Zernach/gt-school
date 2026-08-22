export interface SpendState {
  cap: bigint;
  reserved: bigint;
  actual: bigint;
}

export function assertMicrocents(value: unknown, label = 'microcents'): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${label}_invalid`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}_invalid`);
  return BigInt(value);
}

export function canReserve(state: SpendState, estimate: bigint): boolean {
  if (estimate < 0n) throw new Error('estimate_invalid');
  return state.reserved + estimate <= state.cap;
}

export function reserve(state: SpendState, estimate: bigint): SpendState {
  if (!canReserve(state, estimate)) throw new Error('spend_cap_reached');
  return { ...state, reserved: state.reserved + estimate };
}

export function settle(state: SpendState, actual: bigint): SpendState & { released: bigint } {
  if (actual < 0n || actual > state.reserved) throw new Error('actual_cost_invalid');
  return { ...state, actual, released: state.reserved - actual };
}
