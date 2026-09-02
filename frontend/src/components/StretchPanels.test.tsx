import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { vi } from 'vitest';
import { IncidentGroups } from './IncidentGroups';
import { TicketTable } from './TicketTable';

const group = {
  id: 'incgrp_paid',
  label: 'paid_but_no_deal',
  member_count: 12,
  created_at: '2026-01-15T12:00:00.000Z',
  nearest_group_id: 'incgrp_other'
};

const ticket = {
  id: 'ticket-1',
  message_id: 'msg-1',
  conflict_id: 'conflict_paid_fixture',
  student_ref: 'student:11111111-1111-4111-8111-111111111111',
  family_ref: 'family:aaaaaaaaaaaa',
  system: 'payments',
  record_id: 'pay-1',
  issue_type: 'paid_but_no_deal',
  status: 'open',
  owner: 'ops-c1',
  requested_action: 'review:paid_but_no_deal',
  resolution: null,
  opened_at: '2026-01-15T12:00:00.000Z',
  resolved_at: null
};

describe('incident groups', () => {
  it('renders clustered patterns with member counts', () => {
    const onPatternSelect = vi.fn();
    render(<IncidentGroups defaultOpen groups={[group]} groupedConflicts={12} onPatternSelect={onPatternSelect} />);
    expect(screen.getByRole('heading', { name: 'See the bigger pattern' })).toBeInTheDocument();
    expect(screen.getAllByText('Paid But No Deal')).not.toHaveLength(0);
    expect(screen.getAllByText('12')).not.toHaveLength(0);
    expect(screen.getByText('incgrp_other')).toBeInTheDocument();
    expect(screen.getByText('Pattern not in this view')).toBeInTheDocument();
    expect(screen.getAllByText('100.0%')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Review this pattern' }));
    expect(onPatternSelect).toHaveBeenCalledWith('paid_but_no_deal');
  });

  it('supports finding a pattern by label or ID', () => {
    render(<IncidentGroups defaultOpen groups={[group, { ...group, id: 'incgrp_other', label: 'other_issue', member_count: 5, nearest_group_id: null }]} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a pattern' }), { target: { value: 'other_issue' } });
    expect(screen.getByRole('row', { name: /Other Issue.*incgrp_other/u })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Paid But No Deal.*incgrp_paid/u })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 patterns')).toBeInTheDocument();
  });

  it('shows an empty state when grouping has not run', () => {
    render(<IncidentGroups defaultOpen groups={[]} />);
    expect(screen.getByRole('heading', { name: 'No incident groups yet' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<IncidentGroups defaultOpen groups={[group]} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('extracted tickets', () => {
  it('explains the fields, summarizes triage, and renders review action', () => {
    const onConflict = vi.fn();
    render(<TicketTable defaultOpen tickets={[ticket]} onConflict={onConflict} />);
    expect(screen.getByRole('heading', { name: 'Add support context' })).toBeInTheDocument();
    expect(screen.getByText(/Connect each request to its student/u)).toBeInTheDocument();
    expect(screen.getByText('student:11111111-1111-4111-8111-111111111111')).toBeInTheDocument();
    expect(screen.getByText('family:aaaaaaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText(/Payments/u)).toBeInTheDocument();
    expect(screen.getByText(/ops-c1/u)).toBeInTheDocument();
    expect(screen.getByText('Review Paid But No Deal')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Missing student reference')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review conflict for Paid But No Deal' }));
    expect(onConflict).toHaveBeenCalledWith('conflict_paid_fixture');
  });

  it('shows an empty extraction state', () => {
    render(<TicketTable defaultOpen tickets={[]} />);
    expect(screen.getByRole('heading', { name: 'No tickets in this evidence window' })).toBeInTheDocument();
    expect(screen.getByText(/Run the stretch extraction job/u)).toBeInTheDocument();
  });

  it('keeps absent references explicit and gives unlinked tickets a manual next step', () => {
    render(<TicketTable defaultOpen tickets={[{ ...ticket, id: 'ticket-unlinked', conflict_id: null, student_ref: null, family_ref: null, record_id: null, status: 'resolved', resolution: 'closed', resolved_at: '2026-01-16T12:00:00.000Z' }]} />);
    expect(screen.getByText('No reference extracted')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('No linked conflict; triage manually.')).toBeInTheDocument();
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: /Review conflict/u })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<TicketTable defaultOpen tickets={[ticket]} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
