import { buildConflict } from '../../src/domain/invariants.js';
import {
  clusterEmbeddings,
  cosineDistance,
  embedConflictPattern,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  formatVector,
  l2Normalize
} from '../../src/domain/embedding.js';
import { canAutoApply, candidateAction } from '../../src/domain/policy.js';
import { extractTicketFields, renderSyntheticMessage } from '../../src/domain/tickets.js';
import { autoApplyEligibleProposals } from '../../src/reconciliation/auto-apply.js';
import { loadConfig } from '../../src/config.js';
import type { DatabasePool } from '../../src/persistence/database.js';

function conflict(type: 'paid_but_no_deal' | 'sensitive_field_only_fix' | 'material_field_disagreement' = 'paid_but_no_deal') {
  return buildConflict(type, ['student:11111111-1111-4111-8111-111111111111', 'payment:pay-1'], ['app', 'crm', 'payments'], type === 'sensitive_field_only_fix' ? ['billing_owner_email'] : ['crm_deal_id'], { fixture: true });
}

describe('conflict-pattern embeddings', () => {
  it('emits a documented 64-d cosine model without raw identifiers', () => {
    const embedding = embedConflictPattern(conflict());
    expect(embedding.model).toBe(EMBEDDING_MODEL);
    expect(embedding.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(embedding.values).toHaveLength(64);
    expect(embedding.featureText).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(formatVector(embedding.values)).toMatch(/^\[-?\d+\.\d+(,-?\d+\.\d+){63}\]$/u);
  });

  it('is deterministic and unit-length', () => {
    const first = embedConflictPattern(conflict());
    const second = embedConflictPattern(conflict());
    expect(second).toEqual(first);
    const norm = Math.sqrt(first.values.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 8);
  });

  it('places the same failure pattern closer than a different type', () => {
    const paid = embedConflictPattern(conflict('paid_but_no_deal')).values;
    const paidTwin = embedConflictPattern(buildConflict('paid_but_no_deal', ['student:other', 'payment:other'], ['app', 'crm', 'payments'], ['crm_deal_id'], { fixture: 'twin' })).values;
    const sensitive = embedConflictPattern(conflict('sensitive_field_only_fix')).values;
    expect(cosineDistance(paid, paidTwin)).toBeLessThan(cosineDistance(paid, sensitive));
  });

  it('clusters identical patterns together and splits distant types', () => {
    const paid = embedConflictPattern(conflict('paid_but_no_deal')).values;
    const grade = embedConflictPattern(conflict('material_field_disagreement')).values;
    const clusters = clusterEmbeddings([
      { conflictId: 'b', embedding: paid },
      { conflictId: 'a', embedding: paid },
      { conflictId: 'c', embedding: grade }
    ], 0.05);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.members.map(({ conflictId }) => conflictId)).toEqual(['a', 'b']);
    expect(l2Normalize(paid)[0]).toBeCloseTo(paid[0] ?? 0);
  });
});

describe('structured ticket extraction', () => {
  it('round-trips every required joinable field from synthetic message text', () => {
    const detected = conflict();
    const message = renderSyntheticMessage(detected, '2026-01-15T12:00:00.000Z');
    const fields = extractTicketFields(message.body);
    expect(fields.studentRef).toBe('student:11111111-1111-4111-8111-111111111111');
    expect(fields.familyRef).toMatch(/^family:[0-9a-f]{12}$/u);
    expect(fields.system).toBe('app');
    expect(fields.recordId).toBe('pay-1');
    expect(fields.issueType).toBe('paid_but_no_deal');
    expect(fields.status).toBe('open');
    expect(fields.owner).toBe('ops-c1');
    expect(fields.requestedAction).toBe('review:paid_but_no_deal');
    expect(fields.openedAt).toBe('2026-01-15T12:00:00.000Z');
  });
});

describe('auto-apply execution is Keystone-internal', () => {
  it('applies an eligible pending proposal, stores rollback, and never touches the source mirror', async () => {
    const detected = conflict('paid_but_no_deal');
    const action = candidateAction(detected);
    expect(canAutoApply(action, 9500, true, true)).toBe(true);
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT records.payload_hash')) return { rows: [{ payload_hash: 'abc' }], rowCount: 1 };
      if (sql.includes('FROM proposals JOIN conflicts')) {
        return {
          rows: [{
            id: '22222222-2222-4222-8222-222222222222',
            conflict_id: 'conflict-1',
            version: 1,
            status: 'pending',
            confidence_bp: 9500,
            sensitive_fields: [],
            sensitive_hold: false,
            action,
            evidence: { confidence: { evidenceComplete: true, missingEvidence: false } },
            type: detected.type,
            conflict_key: detected.conflict_key,
            rule_id: detected.rule_id,
            rule_version: detected.rule_version,
            entity_refs: detected.entity_refs,
            sources_involved: detected.sources_involved,
            disagreeing_fields: detected.disagreeing_fields,
            expected_verdict: detected.expected_verdict,
            conflict_evidence: detected.evidence,
            conflict_status: 'active'
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const transactionQuery = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT status, version FROM proposals')) return { rows: [{ status: 'pending', version: 1 }], rowCount: 1 };
      if (sql.includes('INSERT INTO proposal_applications')) return { rows: [{ id: 'app-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = {
      query,
      connect: vi.fn().mockResolvedValue({ query: transactionQuery, release: vi.fn() })
    } as unknown as DatabasePool;
    const result = await autoApplyEligibleProposals(pool, loadConfig({ NODE_ENV: 'test' }), { tenantId: '11111111-1111-4111-8111-111111111111', requestId: 'req-1' });
    expect(result.applied).toBe(1);
    expect(result.denied).toBe(0);
    expect(result.sourceMirrorHashBefore).toBe(result.sourceMirrorHashAfter);
    expect(statements.some((sql) => sql.includes('INSERT INTO proposal_applications'))).toBe(true);
    expect(statements.some((sql) => sql.includes('proposal_auto_applied'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE source_records'))).toBe(false);
  });

  it('does not auto-apply a sensitive-hold proposal at perfect confidence', async () => {
    const detected = conflict('sensitive_field_only_fix');
    const action = candidateAction(detected);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT records.payload_hash')) return { rows: [{ payload_hash: 'abc' }], rowCount: 1 };
      if (sql.includes('FROM proposals JOIN conflicts')) {
        return {
          rows: [{
            id: '33333333-3333-4333-8333-333333333333',
            conflict_id: 'conflict-sensitive',
            version: 1,
            status: 'pending',
            confidence_bp: 10_000,
            sensitive_fields: action.sensitiveFields,
            sensitive_hold: true,
            action,
            evidence: { confidence: { evidenceComplete: true } },
            type: detected.type,
            conflict_key: detected.conflict_key,
            rule_id: detected.rule_id,
            rule_version: detected.rule_version,
            entity_refs: detected.entity_refs,
            sources_involved: detected.sources_involved,
            disagreeing_fields: detected.disagreeing_fields,
            expected_verdict: detected.expected_verdict,
            conflict_evidence: detected.evidence,
            conflict_status: 'active'
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const result = await autoApplyEligibleProposals({ query } as unknown as DatabasePool, loadConfig({ NODE_ENV: 'test' }), {
      tenantId: '11111111-1111-4111-8111-111111111111',
      requestId: 'req-2'
    });
    expect(result.applied).toBe(0);
    expect(result.sensitiveDenied).toBe(1);
  });
});
