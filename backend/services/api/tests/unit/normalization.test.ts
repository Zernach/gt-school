import fc from 'fast-check';
import {
  assertMinorUnits,
  normalizeCurrency,
  normalizeEmail,
  normalizeGrade,
  normalizeName,
  normalizeState,
  normalizeTimestamp,
  timestampIsReversed
} from '../../src/domain/normalization.js';

describe('normalizeName', () => {
  it.each([
    [' Asher ', 'asher', ['trimmed_whitespace', 'case_folded']],
    ['`Harper`', 'harper', ['removed_wrapper_quote', 'case_folded']],
    ['"Jordan"', 'jordan', ['removed_wrapper_quote', 'case_folded']],
    ["'Riley'", 'riley', ['removed_wrapper_quote', 'case_folded']],
    ['MORGAN', 'morgan', ['case_folded']],
    ['Sage   Marie', 'sage marie', ['collapsed_whitespace', 'case_folded']],
    ['ÉMILE', 'émile', ['case_folded']],
    ['Ａｖｅｒｙ', 'avery', ['unicode_nfkc', 'case_folded']],
    ['  ` Quinn `  ', 'quinn', ['trimmed_whitespace', 'removed_wrapper_quote', 'case_folded']],
    ['Rowan', 'rowan', ['case_folded']]
  ])('normalizes %j to %j with an inspectable trace', (input, expected, trace) => {
    const normalized = normalizeName(input);
    expect(normalized.value).toBe(expected);
    expect(normalized.trace).toEqual(trace);
    expect(normalized.original).toBe(input);
    expect(normalized.version).toBe('normalization-v1');
  });

  it.each(['', ' ', '``', '""', "''", '\t\n'])('rejects an empty normalized name %j', (input) => {
    expect(() => normalizeName(input)).toThrow('name_empty');
  });

  it('is idempotent over clean comparison forms', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z]{1,40}( [A-Za-z]{1,40})?$/u), (input) => {
      const once = normalizeName(input).value;
      expect(normalizeName(once).value).toBe(once);
    }), { numRuns: 250 });
  });

  it('does not remove internal apostrophes or hyphens', () => {
    expect(normalizeName("O'Connor-Smith").value).toBe("o'connor-smith");
  });

  it('preserves substantive spelling differences', () => {
    expect(normalizeName('Sara').value).not.toBe(normalizeName('Sarah').value);
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['Jane.Doe+school@gmail.com', 'janedoe@gmail.com'],
    ['janedoe@gmail.com', 'janedoe@gmail.com'],
    ['jane.doe@googlemail.com', 'janedoe@gmail.com'],
    [' USER@EXAMPLE.TEST ', 'user@example.test'],
    ['first.last+tag@example.test', 'first.last+tag@example.test'],
    ['first.last@example.test', 'first.last@example.test'],
    ['a.b.c+d@gmail.com', 'abc@gmail.com'],
    ['single@example.test', 'single@example.test']
  ])('normalizes provider policy for %s', (input, expected) => {
    expect(normalizeEmail(input).value).toBe(expected);
  });

  it('records every Gmail-specific transformation', () => {
    const result = normalizeEmail(' Jane.Doe+school@GoogleMail.com ');
    expect(result.trace).toEqual([
      'trimmed_whitespace',
      'case_folded',
      'gmail_domain_canonicalized',
      'gmail_plus_alias_removed',
      'gmail_dots_removed'
    ]);
  });

  it('never strips dots or plus aliases from a non-Gmail provider', () => {
    const result = normalizeEmail('jane.doe+school@school.example');
    expect(result.value).toBe('jane.doe+school@school.example');
    expect(result.trace).not.toContain('gmail_plus_alias_removed');
    expect(result.trace).not.toContain('gmail_dots_removed');
  });

  it.each([
    '',
    'missing-at.example.test',
    '@example.test',
    'user@',
    'two@@example.test',
    'space here@example.test',
    '.leading@example.test',
    'trailing.@example.test',
    'user@localhost',
    'user@bad_domain'
  ])('rejects malformed address %j', (input) => {
    expect(() => normalizeEmail(input)).toThrow('email_invalid');
  });

  it('is idempotent for generated valid addresses', () => {
    fc.assert(fc.property(
      fc.tuple(fc.stringMatching(/^[a-z]{1,16}$/u), fc.stringMatching(/^[a-z]{2,10}$/u)),
      ([local, domain]) => {
        const once = normalizeEmail(`${local}@${domain}.test`).value;
        expect(normalizeEmail(once).value).toBe(once);
      }
    ), { numRuns: 250 });
  });
});

describe('normalizeGrade', () => {
  it.each([
    [0, 0],
    [12, 12],
    ['0', 0],
    ['12', 12],
    ['Grade 4', 4],
    ['grade 8', 8],
    ['  Grade 6  ', 6]
  ])('maps %j to integer grade %d', (input, expected) => {
    expect(normalizeGrade(input).value).toBe(expected);
  });

  it.each([-1, 13, 1.5, 'K', 'Grade thirteen', '', '4th'])('rejects invalid grade %j', (input) => {
    expect(() => normalizeGrade(input)).toThrow('grade_invalid');
  });
});

describe('normalizeState', () => {
  it.each([['TX', 'TX'], ['Tx', 'TX'], ['tx', 'TX'], ['TEXAS', 'TX'], [' texas ', 'TX']])('maps %j to %j', (input, expected) => {
    expect(normalizeState(input).value).toBe(expected);
  });

  it.each(['CA', 'New York', '', 'T X'])('does not guess unknown state %j', (input) => {
    expect(() => normalizeState(input)).toThrow('state_unknown');
  });
});

describe('integer money', () => {
  it.each([0, 1, 100, Number.MAX_SAFE_INTEGER])('accepts safe non-negative minor units %d', (value) => {
    expect(assertMinorUnits(value)).toBe(value);
  });

  it.each([-1, 1.25, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '100', null, undefined, {}, []])('rejects unsafe minor units %j', (value) => {
    expect(() => assertMinorUnits(value)).toThrow('minor_units_invalid');
  });

  it.each([['USD', 'usd'], [' usd ', 'usd'], ['eur', 'eur'], ['JPY', 'jpy']])('canonicalizes currency %j', (input, expected) => {
    expect(normalizeCurrency(input).value).toBe(expected);
  });

  it.each(['US', 'USDD', '$$$', '12A', ''])('rejects invalid currency %j', (input) => {
    expect(() => normalizeCurrency(input)).toThrow('currency_invalid');
  });
});

describe('strict timestamp handling', () => {
  it.each([
    ['2026-01-15T12:00:00Z', '2026-01-15T12:00:00.000Z'],
    ['2026-01-15T12:00:00.123Z', '2026-01-15T12:00:00.123Z'],
    ['2026-01-15T07:00:00-05:00', '2026-01-15T12:00:00.000Z'],
    ['2026-01-15T13:30:00+01:30', '2026-01-15T12:00:00.000Z'],
    ['2024-02-29T23:59:59Z', '2024-02-29T23:59:59.000Z']
  ])('parses RFC3339 %s exactly', (input, expected) => {
    expect(normalizeTimestamp(input).value).toBe(expected);
  });

  it.each([
    '2026-01-15',
    '2026-01-15 12:00:00Z',
    '01/15/2026',
    '2026-1-15T12:00:00Z',
    '2026-01-15T12:00Z',
    '2026-01-15T12:00:00',
    'not-a-date'
  ])('rejects non-RFC3339 syntax %s', (input) => {
    expect(() => normalizeTimestamp(input)).toThrow('timestamp_invalid_rfc3339');
  });

  it.each([
    '2026-02-29T12:00:00Z',
    '2026-13-01T12:00:00Z',
    '2026-00-01T12:00:00Z',
    '2026-01-32T12:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T12:60:00Z',
    '2026-01-01T12:00:60Z'
  ])('rejects an invalid calendar timestamp %s', (input) => {
    expect(() => normalizeTimestamp(input)).toThrow('timestamp_invalid_calendar');
  });

  it.each(['2026-01-01T12:00:00+24:00', '2026-01-01T12:00:00+01:60'])('rejects invalid offsets %s', (input) => {
    expect(() => normalizeTimestamp(input)).toThrow('timestamp_invalid_offset');
  });

  it('flags updated_at before created_at without rewriting it', () => {
    expect(timestampIsReversed('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(true);
    expect(timestampIsReversed('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(false);
  });
});
