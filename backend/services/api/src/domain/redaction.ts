import { sha256 } from './stable.js';

const SENSITIVE_KEY = /(email|name|dob|payload|secret|token|password|key)$/iu;

export function redactMetadata(value: unknown, mode: 'redacted' | 'full' = 'redacted'): unknown {
  if (mode === 'full') return value;
  if (Array.isArray(value)) return value.map((item) => redactMetadata(item, mode));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) && item !== null && item !== undefined
        ? `[redacted:${sha256(String(item)).slice(0, 12)}]`
        : redactMetadata(item, mode)
    ]));
  }
  return value;
}
