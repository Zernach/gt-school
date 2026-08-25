import type { ConflictDetail, ConflictFilters, ConflictList, ConflictRow, OverviewData, Proposal } from '../types';

export const FIXED_TIME = '2026-01-15T12:00:00.000Z';

export function overviewFixture(overrides: Partial<OverviewData> = {}): OverviewData {
  return {
    sources: [
      {
        source_kind: 'app',
        activated_at: FIXED_TIME,
        generation: 3,
        accepted_count: 47_000,
        rejected_count: 0,
        status: 'complete'
      },
      {
        source_kind: 'crm',
        activated_at: FIXED_TIME,
        generation: 3,
        accepted_count: 55_000,
        rejected_count: 0,
        status: 'complete'
      },
      {
        source_kind: 'payments',
        activated_at: FIXED_TIME,
        generation: 3,
        accepted_count: 18_000,
        rejected_count: 0,
        status: 'complete'
      }
    ],
    conflicts: {
      active: '3050',
      resolved: '25',
      oscillation_hold: '0'
    },
    proposals: [
      { status: 'approved', count: 1 },
      { status: 'pending', count: 3049 }
    ],
    invariant: {
      status: 'complete',
      summary: {
        pass: 347_650,
        fail: 3050,
        unchecked: 0,
        error: 0
      },
      source_availability: {
        app: 'complete',
        crm: 'complete',
        payments: 'complete'
      },
      completed_at: FIXED_TIME
    },
    spend: {
      cap_microcents: '1000000',
      reserved_microcents: '6100',
      actual_microcents: '6100',
      released_microcents: '24400'
    },
    latestRun: {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'complete',
      requested_generation: 3,
      source_availability: {
        app: 'complete',
        crm: 'complete',
        payments: 'complete'
      },
      completed_at: FIXED_TIME
    },
    stretch: {
      incidentGroups: 14,
      groupedConflicts: 3050,
      extractedTickets: 3050
    },
    privacy: {
      mode: 'redacted',
      retentionDays: 30,
      policyVersion: 'privacy-v1',
      audit: 'append-only hashed metadata; raw PII is not stored in logs',
      alerts: 'deleted after 30 days'
    },
    latestAlert: null,
    reconciliation: {
      ok: true,
      checks: [
        { name: 'ingestion_matches_active_snapshots', actual: 120_000, expected: 120_000, ok: true },
        { name: 'conflicts_match_invariant_fail', actual: 3050, expected: 3050, ok: true },
        { name: 'pending_proposals_within_active_conflicts', actual: 3049, expected: 3050, ok: true },
        { name: 'spend_within_daily_cap', actual: 6100, expected: 1_000_000, ok: true }
      ]
    },
    ...overrides
  };
}

export function conflictFixture(overrides: Partial<ConflictRow> = {}): ConflictRow {
  return {
    id: 'conflict_paid_fixture',
    type: 'paid_but_no_deal',
    entity_refs: ['student:11111111-1111-4111-8111-111111111111', 'payment:payment-record-1'],
    sources_involved: ['app', 'crm', 'payments'],
    disagreeing_fields: ['crm_deal_id'],
    status: 'active',
    last_seen_at: FIXED_TIME,
    latest_generation: 3,
    oscillation_count: 0,
    proposal_id: '22222222-2222-4222-8222-222222222222',
    proposal_status: 'pending',
    confidence_bp: 7500,
    sensitive_hold: false,
    ...overrides
  };
}

export function conflictListFixture(overrides: Partial<ConflictList> = {}): ConflictList {
  return {
    items: [
      conflictFixture(),
      conflictFixture({
        id: 'conflict_sensitive_fixture',
        type: 'sensitive_field_only_fix',
        entity_refs: ['student:22222222-2222-4222-8222-222222222222'],
        sources_involved: ['crm', 'payments'],
        disagreeing_fields: ['billing_owner_email'],
        proposal_id: '33333333-3333-4333-8333-333333333333',
        proposal_status: 'held',
        confidence_bp: 3000,
        sensitive_hold: true
      })
    ],
    nextCursor: 'next-page-cursor',
    ...overrides
  };
}

export function proposalFixture(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    conflict_id: 'conflict_paid_fixture',
    conflict_type: 'paid_but_no_deal',
    entity_refs: ['student:11111111-1111-4111-8111-111111111111', 'payment:payment-record-1'],
    sources_involved: ['app', 'crm', 'payments'],
    disagreeing_fields: ['crm_deal_id'],
    action: {
      kind: 'link_or_create_deal_review',
      targetField: 'crm_deal_id',
      proposedValue: 'review:conflict_paid_fixture',
      policyVersion: 'actions-v1'
    },
    evidence: {
      rule: 'C1',
      payment_id: 'payment-1',
      source_systems_unchanged: true
    },
    confidence_bp: 7500,
    confidence_signals: {
      hardIdAgreement: true,
      exactEmailAgreement: false,
      missingEvidence: false,
      sensitiveAction: false
    },
    sensitive_fields: [],
    sensitive_hold: false,
    status: 'pending',
    version: 1,
    estimated_cost_microcents: '10',
    actual_cost_microcents: '2',
    created_at: FIXED_TIME,
    ...overrides
  };
}

export function conflictDetailFixture(overrides: Partial<ConflictDetail> = {}): ConflictDetail {
  return {
    ...conflictFixture(),
    rule_id: 'C1',
    rule_version: 'invariants-v1',
    expected_verdict: 'fail',
    evidence: {
      payment_id: 'payment-1',
      enrollment_id: 'enrollment-1'
    },
    proposal: proposalFixture(),
    lineage: [
      {
        source_kind: 'app',
        entity_kind: 'enrollment',
        source_id: 'enrollment-1',
        field_path: 'crm_deal_id',
        raw_value: null,
        normalized_value: null,
        normalization_version: 'normalization-v1',
        transformation_trace: [],
        source_observed_at: FIXED_TIME,
        ingested_at: FIXED_TIME
      },
      {
        source_kind: 'payments',
        entity_kind: 'payment',
        source_id: 'payment-record-1',
        field_path: 'payer_email',
        raw_value: 'Guardian.One+school@gmail.com',
        normalized_value: 'guardianone@gmail.com',
        normalization_version: 'normalization-v1',
        transformation_trace: ['case_folded', 'gmail_plus_alias_removed', 'gmail_dots_removed'],
        source_observed_at: FIXED_TIME,
        ingested_at: FIXED_TIME
      }
    ],
    audit: [
      {
        event_type: 'sync_completed',
        actor: 'system:sync',
        object_type: 'sync_run',
        object_id: 'sync-1',
        metadata: { accepted: 120_000 },
        created_at: FIXED_TIME
      },
      {
        event_type: 'proposal_created',
        actor: 'system:reconciler',
        object_type: 'proposal',
        object_id: '22222222-2222-4222-8222-222222222222',
        metadata: { cost_microcents: 2 },
        created_at: FIXED_TIME
      }
    ],
    incidentGroup: {
      id: 'incgrp_paid',
      label: 'paid_but_no_deal',
      member_count: 12,
      distance_bp: 80
    },
    tickets: [
      {
        id: 'ticket-1',
        message_id: 'msg_paid',
        conflict_id: 'conflict_paid_fixture',
        student_ref: 'student:11111111-1111-4111-8111-111111111111',
        family_ref: 'family:aaaaaaaaaaaa',
        system: 'payments',
        record_id: 'payment-record-1',
        issue_type: 'paid_but_no_deal',
        status: 'open',
        owner: 'ops-c1',
        requested_action: 'review:paid_but_no_deal',
        resolution: null,
        opened_at: FIXED_TIME,
        resolved_at: null
      }
    ],
    ...overrides
  };
}

export const emptyFilters: ConflictFilters = {
  type: '',
  source: '',
  status: '',
  proposalStatus: '',
  minimumConfidence: '',
  from: ''
};
