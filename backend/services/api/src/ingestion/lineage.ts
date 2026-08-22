import { normalizeCurrency, normalizeEmail, normalizeGrade, normalizeName, normalizeTimestamp, NORMALIZATION_VERSION } from '../domain/normalization.js';
import type { SourceRecord } from '../sources/adapter.js';

export interface FieldLineage {
  fieldPath: string;
  rawValue: unknown;
  normalizedValue: unknown;
  trace: string[];
  version: string;
}

const MATERIAL_FIELDS: Record<string, string[]> = {
  contact: ['email', 'first_name', 'last_name', 'grade', 'lifecycle_stage', 'billing_owner_email', 'created_at', 'updated_at'],
  deal: ['pipeline', 'stage', 'amount', 'associated_contact_ids', 'created_at', 'updated_at'],
  student: ['first_name', 'last_name', 'dob', 'grade', 'guardian_email', 'guardian2_email', 'status', 'created_at', 'updated_at'],
  enrollment: ['student_id', 'stage', 'deposit_paid_at', 'crm_deal_id', 'created_at', 'updated_at'],
  payment: ['payer_email', 'payer_name', 'amount_cents', 'currency', 'type', 'status', 'external_ref', 'occurred_at']
};

function normalizeField(field: string, value: unknown): { value: unknown; trace: string[] } {
  if (value === null) return { value: null, trace: [] };
  if (typeof value === 'undefined') return { value: null, trace: ['missing'] };
  try {
    if (field.includes('email') && typeof value === 'string') {
      const normalized = normalizeEmail(value);
      return { value: normalized.value, trace: normalized.trace };
    }
    if ((field === 'first_name' || field === 'last_name' || field === 'payer_name') && typeof value === 'string') {
      const normalized = normalizeName(value);
      return { value: normalized.value, trace: normalized.trace };
    }
    if (field === 'grade' && (typeof value === 'string' || typeof value === 'number')) {
      const normalized = normalizeGrade(value);
      return { value: normalized.value, trace: normalized.trace };
    }
    if (field === 'currency' && typeof value === 'string') {
      const normalized = normalizeCurrency(value);
      return { value: normalized.value, trace: normalized.trace };
    }
    if ((field.endsWith('_at') || field === 'occurred_at') && typeof value === 'string') {
      const normalized = normalizeTimestamp(value);
      return { value: normalized.value, trace: normalized.trace };
    }
  } catch (error) {
    return { value: null, trace: [`normalization_error:${error instanceof Error ? error.message : 'unknown'}`] };
  }
  return { value, trace: [] };
}

export function lineageForRecord(record: SourceRecord): FieldLineage[] {
  const fields = MATERIAL_FIELDS[record.entityKind] ?? Object.keys(record.payload).sort();
  return fields.map((fieldPath) => {
    const rawValue = record.payload[fieldPath];
    const normalized = normalizeField(fieldPath, rawValue);
    return { fieldPath, rawValue: rawValue ?? null, normalizedValue: normalized.value, trace: normalized.trace, version: NORMALIZATION_VERSION };
  });
}
