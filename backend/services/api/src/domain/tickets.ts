import type { ConflictType, DetectedConflict } from './fixture-types.js';
import { sha256, stableKey } from './stable.js';

export const TICKET_EXTRACTION_VERSION = 'tickets-v1';

export interface ExtractedTicketFields {
  studentRef: string | null;
  familyRef: string | null;
  system: 'crm' | 'app' | 'payments' | 'unknown';
  recordId: string | null;
  issueType: string;
  status: 'open' | 'pending' | 'resolved';
  owner: string;
  requestedAction: string;
  resolution: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
}

export interface SyntheticMessage {
  messageId: string;
  body: string;
  receivedAt: string;
}

const FAMILY_FROM_STUDENT = /student:([0-9a-f-]{36})/iu;

export function syntheticFamilyRef(studentRef: string | undefined): string | null {
  if (!studentRef) return null;
  return `family:${sha256(studentRef).slice(0, 12)}`;
}

export function renderSyntheticMessage(conflict: DetectedConflict, receivedAt: string): SyntheticMessage {
  const studentRef = conflict.entity_refs.find((ref) => ref.startsWith('student:')) ?? null;
  const recordRef = conflict.entity_refs.find((ref) => !ref.startsWith('student:')) ?? conflict.entity_refs[0] ?? 'record:unknown';
  const familyRef = syntheticFamilyRef(studentRef ?? undefined);
  const system = conflict.sources_involved[0] ?? 'unknown';
  const recordId = recordRef.includes(':') ? recordRef.slice(recordRef.indexOf(':') + 1) : recordRef;
  const owner = `ops-${conflict.rule_id.toLocaleLowerCase('en-US')}`;
  const openedAt = receivedAt;
  const variant = Number.parseInt(sha256(conflict.conflict_key).slice(0, 2), 16) % 3;
  const fields = {
    student: studentRef ?? 'none',
    family: familyRef ?? 'none',
    system,
    record_id: recordId,
    issue_type: conflict.type,
    status: 'open',
    owner,
    requested_action: `review:${conflict.type}`,
    resolution: 'none',
    opened_at: openedAt,
    resolved_at: 'none'
  };
  const messageId = stableKey('msg', { conflict: conflict.conflict_key, version: TICKET_EXTRACTION_VERSION });
  const canonical = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
  const body = variant === 1
    ? `Support ticket\n${canonical}\nPlease investigate before families notice the pattern.`
    : variant === 2
      ? `Please help — ${JSON.stringify(fields)}\n${canonical}`
      : canonical;
  return { messageId, body, receivedAt };
}

function capture(pattern: RegExp, body: string): string | null {
  const match = body.match(pattern);
  const value = match?.[1]?.trim();
  return value && value !== 'none' ? value : null;
}

export function extractTicketFields(body: string): ExtractedTicketFields {
  const parsedJson = body.match(/\{[\s\S]*\}/u);
  let fromJson: Partial<Record<string, string>> = {};
  if (parsedJson?.[0]) {
    try {
      fromJson = JSON.parse(parsedJson[0]) as Record<string, string>;
    } catch {
      fromJson = {};
    }
  }
  const studentRef = fromJson.student ?? capture(/student(?:_ref)?:\s*(student:[0-9a-f-]{36}|none)/iu, body) ?? capture(FAMILY_FROM_STUDENT, body);
  const normalizedStudent = studentRef && studentRef !== 'none'
    ? (studentRef.startsWith('student:') ? studentRef : `student:${studentRef}`)
    : null;
  const systemRaw = (fromJson.system ?? capture(/system:\s*(crm|app|payments|unknown)/iu, body) ?? 'unknown').toLocaleLowerCase('en-US');
  const system = systemRaw === 'crm' || systemRaw === 'app' || systemRaw === 'payments' ? systemRaw : 'unknown';
  const statusRaw = (fromJson.status ?? capture(/status[=:\s]+(open|pending|resolved)/iu, body) ?? 'open').toLocaleLowerCase('en-US');
  const status = statusRaw === 'pending' || statusRaw === 'resolved' ? statusRaw : 'open';
  return {
    studentRef: normalizedStudent,
    familyRef: fromJson.family && fromJson.family !== 'none' ? fromJson.family : capture(/family:\s*(family:[0-9a-f]+|none)/iu, body),
    system,
    recordId: fromJson.record_id && fromJson.record_id !== 'none' ? fromJson.record_id : capture(/record(?:_id)?:?\s*([A-Za-z0-9._:-]+)/iu, body),
    issueType: fromJson.issue_type ?? capture(/issue_type:\s*([a-z0-9_]+)/iu, body) ?? 'unknown',
    status,
    owner: fromJson.owner ?? capture(/owner:\s*([A-Za-z0-9._-]+)/iu, body) ?? 'unassigned',
    requestedAction: fromJson.requested_action ?? capture(/requested_action:\s*([A-Za-z0-9:_-]+)/iu, body) ?? 'review',
    resolution: fromJson.resolution && fromJson.resolution !== 'none' ? fromJson.resolution : capture(/resolution[=:\s]+(?!none)([A-Za-z0-9._:-]+)/iu, body),
    openedAt: fromJson.opened_at && fromJson.opened_at !== 'none' ? fromJson.opened_at : capture(/opened_at[=:\s]+(\d{4}-\d{2}-\d{2}T[^\s]+)/iu, body),
    resolvedAt: fromJson.resolved_at && fromJson.resolved_at !== 'none' ? fromJson.resolved_at : capture(/resolved_at[=:\s]+(\d{4}-\d{2}-\d{2}T[^\s]+)/iu, body)
  };
}

export function isKnownIssueType(value: string): value is ConflictType {
  return [
    'paid_but_no_deal', 'payment_with_no_person', 'duplicate_by_email', 'cross_source_email_mismatch',
    'required_source_missing', 'material_field_disagreement', 'enrolled_but_unpaid', 'dropped_sibling',
    'stale_crm_pointer', 'merge_collapsed_record', 'duplicate_payment', 'wrong_amount_payment',
    'refund_not_reflected', 'sensitive_field_only_fix'
  ].includes(value);
}
