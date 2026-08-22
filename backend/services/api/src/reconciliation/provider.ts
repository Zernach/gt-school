import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { DetectedConflict } from '../domain/fixture-types.js';
import type { CandidateAction } from '../domain/policy.js';

const providerOutputSchema = z.object({
  actionFingerprint: z.string().min(1),
  summary: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string()).max(25),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  actualCostMicrocents: z.number().int().nonnegative()
}).strict();

export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export interface ReconcilerProvider {
  readonly mode: string;
  readonly model: string;
  readonly maximumCallCostMicrocents: bigint;
  propose(conflict: DetectedConflict, action: CandidateAction, signal?: AbortSignal): Promise<ProviderOutput>;
}

export class LocalDeterministicProvider implements ReconcilerProvider {
  readonly mode = 'local';
  readonly model = 'keystone-deterministic-v1';
  readonly maximumCallCostMicrocents = 10n;

  async propose(conflict: DetectedConflict, action: CandidateAction, signal?: AbortSignal): Promise<ProviderOutput> {
    if (signal?.aborted) throw signal.reason;
    return providerOutputSchema.parse({
      actionFingerprint: action.fingerprint,
      summary: `Review ${action.kind} for ${conflict.entity_refs.join(', ')}. Source systems remain unchanged.`,
      evidenceRefs: conflict.entity_refs,
      inputTokens: 120 + conflict.entity_refs.length * 8,
      outputTokens: 40,
      actualCostMicrocents: 2
    });
  }
}

export function validateProviderOutput(value: unknown, expectedFingerprint: string): ProviderOutput {
  const output = providerOutputSchema.parse(value);
  if (output.actionFingerprint !== expectedFingerprint) throw new Error('provider_action_fingerprint_mismatch');
  return output;
}

export function createProvider(config: AppConfig): ReconcilerProvider {
  if (config.PROVIDER_MODE === 'local') return new LocalDeterministicProvider();
  throw new Error('external_provider_not_implemented_use_local_mode');
}
