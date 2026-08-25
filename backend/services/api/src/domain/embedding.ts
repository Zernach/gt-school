import type { DetectedConflict } from './fixture-types.js';
import { sha256 } from './stable.js';

export const EMBEDDING_MODEL = 'conflict-pattern-hash-v1';
export const EMBEDDING_DIMENSIONS = 64;
export const EMBEDDING_DISTANCE = 'cosine';
export const EMBEDDING_OPERATOR = '<=>';
export const EMBEDDING_INDEX = 'hnsw';
export const GROUPING_DISTANCE_THRESHOLD = 0.18;

export interface ConflictEmbedding {
  model: typeof EMBEDDING_MODEL;
  dimensions: typeof EMBEDDING_DIMENSIONS;
  values: number[];
  featureText: string;
  featureHash: string;
}

function entityKind(ref: string): string {
  const index = ref.indexOf(':');
  return index === -1 ? 'unknown' : ref.slice(0, index);
}

export function conflictFeatureText(conflict: Pick<DetectedConflict, 'type' | 'rule_id' | 'sources_involved' | 'disagreeing_fields' | 'entity_refs'>): string {
  const kinds = [...new Set(conflict.entity_refs.map(entityKind))].sort();
  const sources = [...conflict.sources_involved].sort();
  const fields = [...conflict.disagreeing_fields].sort();
  return [
    `type:${conflict.type}`,
    `rule:${conflict.rule_id}`,
    ...sources.map((source) => `source:${source}`),
    ...fields.map((field) => `field:${field}`),
    ...kinds.map((kind) => `kind:${kind}`)
  ].join(' ');
}

function hashToUnit(hex: string, offset: number): { index: number; sign: number } {
  const index = Number.parseInt(hex.slice(offset, offset + 8), 16) % EMBEDDING_DIMENSIONS;
  const sign = Number.parseInt(hex.slice(offset + 8, offset + 10), 16) % 2 === 0 ? 1 : -1;
  return { index, sign };
}

export function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return values.map((_, index) => (index === 0 ? 1 : 0));
  return values.map((value) => value / norm);
}

export function embedConflictPattern(conflict: Pick<DetectedConflict, 'type' | 'rule_id' | 'sources_involved' | 'disagreeing_fields' | 'entity_refs'>): ConflictEmbedding {
  const featureText = conflictFeatureText(conflict);
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const token of featureText.split(' ')) {
    const digest = sha256(`${EMBEDDING_MODEL}:${token}`);
    const first = hashToUnit(digest, 0);
    const second = hashToUnit(digest, 10);
    values[first.index] = (values[first.index] ?? 0) + first.sign;
    values[second.index] = (values[second.index] ?? 0) + second.sign * 0.5;
  }
  const normalized = l2Normalize(values);
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    values: normalized,
    featureText,
    featureHash: sha256(featureText)
  };
}

export function formatVector(values: number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) throw new Error('embedding_dimension_mismatch');
  return `[${values.map((value) => value.toFixed(8)).join(',')}]`;
}

export function cosineDistance(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error('embedding_dimension_mismatch');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (denominator === 0) return 1;
  return Math.max(0, Math.min(2, 1 - dot / denominator));
}

export interface IncidentClusterMember {
  conflictId: string;
  embedding: number[];
}

export interface IncidentCluster {
  members: IncidentClusterMember[];
  centroid: number[];
}

export function clusterEmbeddings(members: IncidentClusterMember[], threshold = GROUPING_DISTANCE_THRESHOLD): IncidentCluster[] {
  const ordered = [...members].sort((left, right) => left.conflictId.localeCompare(right.conflictId));
  const clusters: IncidentCluster[] = [];
  for (const member of ordered) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, cluster] of clusters.entries()) {
      const distance = cosineDistance(member.embedding, cluster.centroid);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestDistance <= threshold) {
      const cluster = clusters[bestIndex]!;
      cluster.members.push(member);
      const summed = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, dimension) => (
        cluster.members.reduce((sum, item) => sum + (item.embedding[dimension] ?? 0), 0)
      ));
      cluster.centroid = l2Normalize(summed);
    } else {
      clusters.push({ members: [member], centroid: [...member.embedding] });
    }
  }
  return clusters;
}
