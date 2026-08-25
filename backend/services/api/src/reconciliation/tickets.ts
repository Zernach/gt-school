import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { ConflictType } from '../domain/fixture-types.js';
import { redactMetadata } from '../domain/redaction.js';
import { sha256, stableStringify, stableUuid } from '../domain/stable.js';
import { extractTicketFields, renderSyntheticMessage, TICKET_EXTRACTION_VERSION } from '../domain/tickets.js';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';

interface ConflictRow {
  id: string;
  conflict_key: string;
  rule_id: string;
  rule_version: string;
  type: ConflictType;
  entity_refs: string[];
  sources_involved: Array<'crm' | 'app' | 'payments'>;
  disagreeing_fields: string[];
  expected_verdict: 'fail';
  evidence: Record<string, unknown>;
  last_seen_at: Date | string;
}

export interface TicketExtractionResult {
  extracted: number;
  matchedConflicts: number;
  version: typeof TICKET_EXTRACTION_VERSION;
}

export async function extractTickets(
  pool: DatabasePool,
  config: AppConfig,
  request: { tenantId: string; requestId: string }
): Promise<TicketExtractionResult> {
  const conflicts = await pool.query<ConflictRow>(`SELECT id, conflict_key, rule_id, rule_version, type, entity_refs, sources_involved,
      disagreeing_fields, expected_verdict, evidence, last_seen_at
    FROM conflicts WHERE tenant_id = $1 AND status IN ('active','oscillation_hold') ORDER BY id`, [request.tenantId]);
  let extracted = 0;
  let matchedConflicts = 0;
  await inTransaction(pool, async (client) => {
    for (const row of conflicts.rows) {
      const receivedAt = new Date(row.last_seen_at).toISOString();
      const message = renderSyntheticMessage(row, receivedAt);
      const fields = extractTicketFields(message.body);
      const ticketId = stableUuid(`ticket:${request.tenantId}:${message.messageId}`);
      const matched = fields.issueType === row.type ? row.id : null;
      if (matched) matchedConflicts += 1;
      await client.query(`INSERT INTO extracted_tickets(
          id, tenant_id, message_id, conflict_id, student_ref, family_ref, system, record_id, issue_type, status,
          owner, requested_action, resolution, opened_at, resolved_at, extraction_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (tenant_id, message_id) DO UPDATE SET
          conflict_id = EXCLUDED.conflict_id, student_ref = EXCLUDED.student_ref, family_ref = EXCLUDED.family_ref,
          system = EXCLUDED.system, record_id = EXCLUDED.record_id, issue_type = EXCLUDED.issue_type, status = EXCLUDED.status,
          owner = EXCLUDED.owner, requested_action = EXCLUDED.requested_action, resolution = EXCLUDED.resolution,
          opened_at = EXCLUDED.opened_at, resolved_at = EXCLUDED.resolved_at, extraction_version = EXCLUDED.extraction_version`, [
        ticketId, request.tenantId, message.messageId, matched, fields.studentRef, fields.familyRef, fields.system,
        fields.recordId, fields.issueType, fields.status, fields.owner, fields.requestedAction, fields.resolution,
        fields.openedAt, fields.resolvedAt, TICKET_EXTRACTION_VERSION
      ]);
      extracted += 1;
    }
    const metadata = redactMetadata({ extracted, matchedConflicts, version: TICKET_EXTRACTION_VERSION }, config.LOG_PRIVACY_MODE);
    await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
      VALUES ($1, $2, 'tickets_extracted', 'worker:stretch', $3, 'tenant', $4, $5::jsonb, $6)`, [
      randomUUID(), request.tenantId, request.requestId, request.tenantId, JSON.stringify(metadata), sha256(stableStringify(metadata))
    ]);
  });
  return { extracted, matchedConflicts, version: TICKET_EXTRACTION_VERSION };
}
