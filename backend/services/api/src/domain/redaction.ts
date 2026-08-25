import { sha256 } from './stable.js';

const SENSITIVE_KEY = /(email|name|dob|payload|secret|token|password|key|reason|ssn|phone|address|last_error)$/iu;
const EMAIL_SHAPE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

export const PRIVACY_POLICY_VERSION = 'privacy-v1';

function preview(value: string): string {
  return `[redacted:${sha256(value).slice(0, 12)}]`;
}

export function redactText(value: string): string {
  return value.replaceAll(EMAIL_SHAPE, (match) => preview(match));
}

export function redactMetadata(value: unknown, mode: 'redacted' | 'full' = 'redacted'): unknown {
  if (mode === 'full') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactMetadata(item, mode));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) && item !== null && item !== undefined
        ? preview(String(item))
        : redactMetadata(item, mode)
    ]));
  }
  return value;
}
