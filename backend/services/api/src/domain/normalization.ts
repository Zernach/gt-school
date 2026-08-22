export const NORMALIZATION_VERSION = 'normalization-v1';

export interface Normalized<T> {
  original: unknown;
  value: T;
  trace: string[];
  version: typeof NORMALIZATION_VERSION;
}

function result<T>(original: unknown, value: T, trace: string[]): Normalized<T> {
  return { original, value, trace, version: NORMALIZATION_VERSION };
}

export function normalizeName(input: string): Normalized<string> {
  const trace: string[] = [];
  let value = input.normalize('NFKC');
  if (value !== input) trace.push('unicode_nfkc');
  const trimmed = value.trim();
  if (trimmed !== value) trace.push('trimmed_whitespace');
  value = trimmed;
  while (value.length >= 2 && /["'`]/u.test(value[0] ?? '') && value.at(-1) === value[0]) {
    value = value.slice(1, -1).trim();
    trace.push('removed_wrapper_quote');
  }
  const collapsed = value.replace(/\s+/gu, ' ');
  if (collapsed !== value) trace.push('collapsed_whitespace');
  value = collapsed.toLocaleLowerCase('en-US');
  if (value !== collapsed) trace.push('case_folded');
  if (!value) throw new Error('name_empty');
  return result(input, value, trace);
}

export function normalizeEmail(input: string): Normalized<string> {
  const trace: string[] = [];
  const trimmed = input.trim();
  if (trimmed !== input) trace.push('trimmed_whitespace');
  const lowered = trimmed.toLocaleLowerCase('en-US');
  if (lowered !== trimmed) trace.push('case_folded');
  const parts = lowered.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/u.test(lowered)) {
    throw new Error('email_invalid');
  }
  let [local, domain] = parts as [string, string];
  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
    trace.push('gmail_domain_canonicalized');
  }
  if (domain === 'gmail.com') {
    const untagged = local.split('+', 1)[0] ?? local;
    if (untagged !== local) trace.push('gmail_plus_alias_removed');
    const undotted = untagged.replaceAll('.', '');
    if (undotted !== untagged) trace.push('gmail_dots_removed');
    local = undotted;
  }
  if (!/^[^@.][^@]*[^@.]$|^[^@.]$/u.test(local) || !/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(domain)) {
    throw new Error('email_invalid');
  }
  return result(input, `${local}@${domain}`, trace);
}

export function normalizeGrade(input: string | number): Normalized<number> {
  const text = String(input).trim().toLocaleLowerCase('en-US').replace(/^grade\s+/u, '');
  if (!text) throw new Error('grade_invalid');
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 12) throw new Error('grade_invalid');
  return result(input, value, text === String(input) ? [] : ['grade_format_canonicalized']);
}

const STATE_MAP: Readonly<Record<string, string>> = { tx: 'TX', texas: 'TX' };

export function normalizeState(input: string): Normalized<string> {
  const key = input.trim().toLocaleLowerCase('en-US');
  const value = STATE_MAP[key];
  if (!value) throw new Error('state_unknown');
  return result(input, value, value === input ? [] : ['state_canonicalized']);
}

export function assertMinorUnits(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new Error('minor_units_invalid');
  }
  return input;
}

export function normalizeCurrency(input: string): Normalized<string> {
  const value = input.trim().toLocaleLowerCase('en-US');
  if (!/^[a-z]{3}$/u.test(value)) throw new Error('currency_invalid');
  return result(input, value, value === input ? [] : ['currency_case_folded']);
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;

export function normalizeTimestamp(input: string): Normalized<string> {
  const match = RFC3339.exec(input);
  if (!match) throw new Error('timestamp_invalid_rfc3339');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) {
    throw new Error('timestamp_invalid_calendar');
  }
  if (zone !== 'Z') {
    const zoneHour = Number(zone?.slice(1, 3));
    const zoneMinute = Number(zone?.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) throw new Error('timestamp_invalid_offset');
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.valueOf())) throw new Error('timestamp_invalid');
  const value = parsed.toISOString();
  return result(input, value, value === input ? [] : ['timestamp_to_utc']);
}

export function timestampIsReversed(createdAt: string, updatedAt: string): boolean {
  return normalizeTimestamp(updatedAt).value < normalizeTimestamp(createdAt).value;
}
