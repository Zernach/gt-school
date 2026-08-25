import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import {
  clusterEmbeddings,
  cosineDistance,
  embedConflictPattern,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DISTANCE,
  EMBEDDING_MODEL,
  formatVector,
  type IncidentClusterMember
} from '../domain/embedding.js';
import type { ConflictType } from '../domain/fixture-types.js';
import { redactMetadata } from '../domain/redaction.js';
import { sha256, stableKey, stableStringify } from '../domain/stable.js';
import type { DatabasePool } from '../persistence/database.js';
import { inTransaction } from '../persistence/database.js';

interface ConflictRow {
  id: string;
  type: ConflictType;
  rule_id: string;
  sources_involved: Array<'crm' | 'app' | 'payments'>;
  disagreeing_fields: string[];
  entity_refs: string[];
}

export interface GroupingResult {
  groupingRunId: string;
  memberCount: number;
  groupCount: number;
  model: typeof EMBEDDING_MODEL;
  dimensions: typeof EMBEDDING_DIMENSIONS;
}

export async function groupIncidents(
  pool: DatabasePool,
  config: AppConfig,
  request: { tenantId: string; requestId: string }
): Promise<GroupingResult> {
  const conflicts = await pool.query<ConflictRow>(`SELECT id, type, rule_id, sources_involved, disagreeing_fields, entity_refs
    FROM conflicts WHERE tenant_id = $1 AND status = 'active' ORDER BY id`, [request.tenantId]);
  const members: IncidentClusterMember[] = conflicts.rows.map((row) => ({
    conflictId: row.id,
    embedding: embedConflictPattern(row).values
  }));
  const clusters = clusterEmbeddings(members);
  const groupingRunId = randomUUID();
  await inTransaction(pool, async (client) => {
    await client.query('DELETE FROM incident_group_members WHERE tenant_id = $1', [request.tenantId]);
    await client.query('DELETE FROM incident_groups WHERE tenant_id = $1', [request.tenantId]);
    await client.query('DELETE FROM incident_embeddings WHERE tenant_id = $1', [request.tenantId]);
    await client.query(`INSERT INTO grouping_runs(id, tenant_id, model, dimensions, distance_metric, member_count, group_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [groupingRunId, request.tenantId, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_DISTANCE, members.length, clusters.length]);
    for (const row of conflicts.rows) {
      const embedding = embedConflictPattern(row);
      await client.query(`INSERT INTO incident_embeddings(tenant_id, conflict_id, grouping_run_id, model, dimensions, embedding, feature_text, feature_hash)
        VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)`, [
        request.tenantId, row.id, groupingRunId, embedding.model, embedding.dimensions, formatVector(embedding.values), embedding.featureText, embedding.featureHash
      ]);
    }
    for (const cluster of clusters) {
      const conflictIds = cluster.members.map(({ conflictId }) => conflictId).sort();
      const groupId = stableKey('incgrp', conflictIds);
      const label = majorityLabel(conflicts.rows, conflictIds);
      await client.query(`INSERT INTO incident_groups(id, tenant_id, grouping_run_id, label, member_count, centroid)
        VALUES ($1, $2, $3, $4, $5, $6::vector)`, [groupId, request.tenantId, groupingRunId, label, cluster.members.length, formatVector(cluster.centroid)]);
      for (const member of cluster.members) {
        const distanceBp = Math.round(cosineDistance(member.embedding, cluster.centroid) * 10_000);
        await client.query(`INSERT INTO incident_group_members(tenant_id, grouping_run_id, group_id, conflict_id, distance_bp)
          VALUES ($1, $2, $3, $4, $5)`, [request.tenantId, groupingRunId, groupId, member.conflictId, distanceBp]);
      }
    }
    const metadata = redactMetadata({ groupingRunId, memberCount: members.length, groupCount: clusters.length, model: EMBEDDING_MODEL }, config.LOG_PRIVACY_MODE);
    await client.query(`INSERT INTO audit_events(id, tenant_id, event_type, actor, request_id, object_type, object_id, metadata, event_hash)
      VALUES ($1, $2, 'incidents_grouped', 'worker:stretch', $3, 'grouping_run', $4, $5::jsonb, $6)`, [
      randomUUID(), request.tenantId, request.requestId, groupingRunId, JSON.stringify(metadata), sha256(stableStringify(metadata))
    ]);
  });
  return { groupingRunId, memberCount: members.length, groupCount: clusters.length, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
}

function majorityLabel(rows: ConflictRow[], conflictIds: string[]): string {
  const counts = new Map<string, number>();
  const selected = new Set(conflictIds);
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'mixed';
}
