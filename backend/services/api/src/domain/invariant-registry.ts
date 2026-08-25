import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { conflictTypes } from './fixture-types.js';
import { RULE_BY_TYPE, RULE_DEPENDENCIES, RULE_SET_VERSION } from './invariants.js';

const registrySchema = z.object({
  version: z.literal(RULE_SET_VERSION),
  rules: z.array(z.object({
    id: z.string().regex(/^C(?:[1-9]|1[0-4])$/u),
    version: z.literal('1.0.0'),
    type: z.enum(conflictTypes),
    dependencies: z.array(z.enum(['crm', 'app', 'payments'])).min(1),
    sensitivity: z.enum(['non_sensitive', 'identity', 'financial_status', 'billing_owner'])
  })).length(14)
});

export type InvariantRegistry = z.infer<typeof registrySchema>;

export function loadInvariantRegistry(configRoot: string): InvariantRegistry {
  const registry = registrySchema.parse(JSON.parse(readFileSync(join(configRoot, 'invariants.v1.json'), 'utf8')));
  assertInvariantRegistryMatchesCode(registry);
  return registry;
}

export function assertInvariantRegistryMatchesCode(registry: InvariantRegistry): void {
  if (registry.version !== RULE_SET_VERSION) throw new Error(`invariant_registry_version_mismatch:${registry.version}`);
  for (const rule of registry.rules) {
    if (RULE_BY_TYPE[rule.type] !== rule.id) throw new Error(`invariant_registry_id_mismatch:${rule.type}`);
    const expected = RULE_DEPENDENCIES[rule.type];
    if (rule.dependencies.length !== expected.length || rule.dependencies.some((source, index) => source !== expected[index])) {
      throw new Error(`invariant_registry_dependencies_mismatch:${rule.type}`);
    }
  }
}
