import fc from 'fast-check';
import { buildConflict } from '../../src/domain/invariants.js';
import { candidateAction } from '../../src/domain/policy.js';
import { redactMetadata } from '../../src/domain/redaction.js';
import { sha256, stableKey, stableStringify, stableUuid } from '../../src/domain/stable.js';
import { LocalDeterministicProvider, createProvider, validateProviderOutput } from '../../src/reconciliation/provider.js';
import { loadConfig } from '../../src/config.js';

describe('stable serialization and identifiers', () => {
  it('sorts object keys recursively', () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('preserves array order while sorting array item objects', () => {
    expect(stableStringify([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  it('supports pretty deterministic output', () => {
    expect(stableStringify({ b: 2, a: 1 }, 2)).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('hashes identical canonical text identically', () => {
    expect(sha256(stableStringify({ b: 2, a: 1 }))).toBe(sha256(stableStringify({ a: 1, b: 2 })));
  });

  it('hashes buffers and strings identically for the same bytes', () => {
    expect(sha256('fixture')).toBe(sha256(Buffer.from('fixture')));
  });

  it('produces a version-4-shaped deterministic UUID', () => {
    const value = stableUuid('fixture');
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(stableUuid('fixture')).toBe(value);
    expect(stableUuid('different')).not.toBe(value);
  });

  it('produces a compact prefixed stable key', () => {
    expect(stableKey('action', { b: 2, a: 1 })).toMatch(/^action_[0-9a-f]{24}$/u);
    expect(stableKey('action', { b: 2, a: 1 })).toBe(stableKey('action', { a: 1, b: 2 }));
  });

  it('is deterministic across arbitrary JSON-compatible records', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      expect(stableStringify(value)).toBe(stableStringify(structuredClone(value)));
    }), { numRuns: 500 });
  });
});

describe('privacy-safe metadata logging', () => {
  it.each([
    'email',
    'guardian_email',
    'name',
    'first_name',
    'dob',
    'payload',
    'secret',
    'trigger_secret',
    'token',
    'api_token',
    'password',
    'client_key',
    'last_error'
  ])('redacts sensitive key %s', (key) => {
    const result = redactMetadata({ [key]: 'sensitive-value' }) as Record<string, string>;
    expect(result[key]).toMatch(/^\[redacted:[0-9a-f]{12}\]$/u);
    expect(result[key]).not.toContain('sensitive-value');
  });

  it('retains non-sensitive operating metadata', () => {
    expect(redactMetadata({ status: 'complete', count: 12, durationMs: 34 })).toEqual({ status: 'complete', count: 12, durationMs: 34 });
  });

  it('redacts recursively inside objects', () => {
    const result = redactMetadata({ evidence: { payer_email: 'payer@example.test', rule_id: 'C14' } }) as { evidence: Record<string, string> };
    expect(result.evidence.payer_email).toMatch(/^\[redacted:/u);
    expect(result.evidence.rule_id).toBe('C14');
  });

  it('redacts recursively inside arrays', () => {
    const result = redactMetadata([{ name: 'Alice' }, { name: 'Bob' }]) as Array<Record<string, string>>;
    expect(result[0]?.name).toMatch(/^\[redacted:/u);
    expect(result[1]?.name).toMatch(/^\[redacted:/u);
  });

  it('preserves null and undefined without inventing hashes', () => {
    expect(redactMetadata({ email: null, secret: undefined })).toEqual({ email: null, secret: undefined });
  });

  it('redacts email-shaped values even on ordinary keys', () => {
    expect(redactMetadata({ note: 'contact jordan@example.test immediately' })).toEqual({
      note: expect.stringMatching(/contact \[redacted:[0-9a-f]{12}\] immediately/u)
    });
  });

  it('redacts reviewer reasons in stored logs', () => {
    const result = redactMetadata({ reason: 'Jordan Rivera legal name is wrong' }) as { reason: string };
    expect(result.reason).toMatch(/^\[redacted:[0-9a-f]{12}\]$/u);
    expect(result.reason).not.toContain('Jordan');
  });

  it('allows explicit full fixture-only mode', () => {
    const value = { email: 'synthetic@example.test', nested: { name: 'Synthetic Person' } };
    expect(redactMetadata(value, 'full')).toBe(value);
  });

  it('uses stable hashes to correlate repeated synthetic values', () => {
    const first = redactMetadata({ email: 'same@example.test' });
    const second = redactMetadata({ email: 'same@example.test' });
    const different = redactMetadata({ email: 'different@example.test' });
    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });
});

describe('local deterministic reconciler provider', () => {
  const detected = buildConflict('paid_but_no_deal', ['student:test', 'payment:test'], ['app', 'crm', 'payments'], ['crm_deal_id']);
  const action = candidateAction(detected);

  it('has an explicit mode, model, and worst-case cost', () => {
    const provider = new LocalDeterministicProvider();
    expect(provider.mode).toBe('local');
    expect(provider.model).toBe('keystone-deterministic-v1');
    expect(provider.maximumCallCostMicrocents).toBe(10n);
  });

  it('returns schema-valid deterministic output', async () => {
    const provider = new LocalDeterministicProvider();
    const first = await provider.propose(detected, action);
    const second = await provider.propose(detected, action);
    expect(second).toEqual(first);
    expect(first.actionFingerprint).toBe(action.fingerprint);
    expect(first.summary).toContain('Source systems remain unchanged.');
    expect(first.evidenceRefs).toEqual(detected.entity_refs);
    expect(first.actualCostMicrocents).toBeLessThanOrEqual(Number(provider.maximumCallCostMicrocents));
  });

  it('honors a pre-aborted provider signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(new LocalDeterministicProvider().propose(detected, action, controller.signal)).rejects.toThrow('cancelled');
  });

  it('rejects output with a mismatched action fingerprint', () => {
    expect(() => validateProviderOutput({
      actionFingerprint: 'wrong',
      summary: 'Safe summary',
      evidenceRefs: [],
      inputTokens: 1,
      outputTokens: 1,
      actualCostMicrocents: 1
    }, action.fingerprint)).toThrow('provider_action_fingerprint_mismatch');
  });

  it.each([
    {},
    { actionFingerprint: action.fingerprint },
    { actionFingerprint: action.fingerprint, summary: '', evidenceRefs: [], inputTokens: 1, outputTokens: 1, actualCostMicrocents: 1 },
    { actionFingerprint: action.fingerprint, summary: 'ok', evidenceRefs: [], inputTokens: -1, outputTokens: 1, actualCostMicrocents: 1 },
    { actionFingerprint: action.fingerprint, summary: 'ok', evidenceRefs: [], inputTokens: 1, outputTokens: 1, actualCostMicrocents: -1 },
    { actionFingerprint: action.fingerprint, summary: 'ok', evidenceRefs: [], inputTokens: 1.5, outputTokens: 1, actualCostMicrocents: 1 },
    { actionFingerprint: action.fingerprint, summary: 'ok', evidenceRefs: [], inputTokens: 1, outputTokens: 1, actualCostMicrocents: 1, unsupported: true }
  ])('rejects malformed provider output %#', (value) => {
    expect(() => validateProviderOutput(value, action.fingerprint)).toThrow();
  });

  it('creates the local provider from default configuration', () => {
    const provider = createProvider(loadConfig({ NODE_ENV: 'test' }));
    expect(provider).toBeInstanceOf(LocalDeterministicProvider);
  });

  it('refuses an unimplemented external mode even when explicitly keyed', () => {
    const config = loadConfig({ NODE_ENV: 'test', PROVIDER_MODE: 'external', PROVIDER_API_KEY: 'fixture-provider-key-only' });
    expect(() => createProvider(config)).toThrow('external_provider_not_implemented_use_local_mode');
  });
});
