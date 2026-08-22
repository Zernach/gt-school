import { z } from 'zod';

const timestamp = z.string().min(20).max(35);
const email = z.string().min(3).max(320);

export const crmContactSchema = z.object({
  crm_id: z.string().min(1),
  email,
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  lifecycle_stage: z.string().min(1),
  created_at: timestamp,
  updated_at: timestamp,
  external_id: z.string().min(1).optional(),
  dob: z.string().optional(),
  grade: z.union([z.string(), z.number()]).optional(),
  household_id: z.string().optional(),
  role: z.enum(['student', 'lead']),
  billing_owner_email: email.optional(),
  address_state: z.string().optional(),
  secondary_person: z.object({
    first_name: z.string(),
    last_name: z.string(),
    dob: z.string(),
    email
  }).optional()
}).strict();

export const crmDealSchema = z.object({
  deal_id: z.string().min(1),
  name: z.string().min(1),
  pipeline: z.string().min(1),
  stage: z.string().min(1),
  amount: z.number().int().nonnegative(),
  associated_contact_ids: z.array(z.string()),
  created_at: timestamp,
  updated_at: timestamp
}).strict();

export const appStudentSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  dob: z.string(),
  grade: z.union([z.string(), z.number()]),
  guardian_email: email,
  guardian2_email: email.nullable(),
  status: z.string().min(1),
  enrollment_year: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
  household_id: z.string().optional(),
  address_state: z.string().optional()
}).strict();

export const appEnrollmentSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  program: z.string().min(1),
  stage: z.string().min(1),
  deposit_paid_at: timestamp.nullable(),
  crm_deal_id: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp
}).strict();

export const paymentSchema = z.object({
  fixture_record_id: z.string().min(1),
  payment_id: z.string().min(1),
  payer_email: email,
  payer_name: z.string().min(1),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  type: z.enum(['fee', 'deposit', 'tuition']),
  status: z.enum(['paid', 'refunded']),
  occurred_at: timestamp,
  external_ref: z.string().min(1).optional(),
  student_name: z.string().min(1).optional(),
  student_dob: z.string().min(1).optional()
}).strict();

export type CrmContact = z.infer<typeof crmContactSchema>;
export type CrmDeal = z.infer<typeof crmDealSchema>;
export type AppStudent = z.infer<typeof appStudentSchema>;
export type AppEnrollment = z.infer<typeof appEnrollmentSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type SourceKind = 'crm' | 'app' | 'payments';
export type Availability = 'complete' | 'partial' | 'failed';

export interface FixtureSet {
  crmContacts: CrmContact[];
  crmDeals: CrmDeal[];
  appStudents: AppStudent[];
  appEnrollments: AppEnrollment[];
  payments: Payment[];
}

export const conflictTypes = [
  'paid_but_no_deal',
  'payment_with_no_person',
  'duplicate_by_email',
  'cross_source_email_mismatch',
  'required_source_missing',
  'material_field_disagreement',
  'enrolled_but_unpaid',
  'dropped_sibling',
  'stale_crm_pointer',
  'merge_collapsed_record',
  'duplicate_payment',
  'wrong_amount_payment',
  'refund_not_reflected',
  'sensitive_field_only_fix'
] as const;

export type ConflictType = (typeof conflictTypes)[number];

export interface DetectedConflict {
  conflict_key: string;
  rule_id: string;
  rule_version: string;
  type: ConflictType;
  entity_refs: string[];
  sources_involved: SourceKind[];
  disagreeing_fields: string[];
  expected_verdict: 'fail';
  evidence: Record<string, unknown>;
}

export interface GoldenConflict extends DetectedConflict {
  cause_refs: string[];
}
