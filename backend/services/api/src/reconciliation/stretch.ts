import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/database.js';
import { autoApplyEligibleProposals, type AutoApplyResult } from './auto-apply.js';
import { groupIncidents, type GroupingResult } from './grouping.js';
import { retainLogs, type RetentionResult } from './retention.js';
import { extractTickets, type TicketExtractionResult } from './tickets.js';

export interface StretchRequest {
  tenantId: string;
  requestId: string;
}

export interface StretchResult {
  status: 'complete';
  grouping: GroupingResult;
  tickets: TicketExtractionResult;
  autoApply: AutoApplyResult;
  retention: RetentionResult;
  durationMs: number;
}

export async function runStretchOps(pool: DatabasePool, config: AppConfig, request: StretchRequest): Promise<StretchResult> {
  const started = performance.now();
  const grouping = await groupIncidents(pool, config, request);
  const tickets = await extractTickets(pool, config, request);
  const autoApply = await autoApplyEligibleProposals(pool, config, request);
  const retention = await retainLogs(pool, config, request);
  return { status: 'complete', grouping, tickets, autoApply, retention, durationMs: Math.round(performance.now() - started) };
}
