import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
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
    render(<IncidentGroups groups={[group]} />);
    expect(screen.getByRole('heading', { name: 'Incident groups' })).toBeInTheDocument();
    expect(screen.getByText('Paid But No Deal')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('incgrp_other')).toBeInTheDocument();
  });

  it('shows an empty state when grouping has not run', () => {
    render(<IncidentGroups groups={[]} />);
    expect(screen.getByRole('heading', { name: 'No incident groups yet' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<IncidentGroups groups={[group]} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('extracted tickets', () => {
  it('renders joinable student, family, system, and action fields', () => {
    render(<TicketTable tickets={[ticket]} />);
    expect(screen.getByRole('heading', { name: 'Extracted tickets' })).toBeInTheDocument();
    expect(screen.getByText('student:11111111-1111-4111-8111-111111111111')).toBeInTheDocument();
    expect(screen.getByText('family:aaaaaaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText(/payments/u)).toBeInTheDocument();
    expect(screen.getByText(/ops-c1/u)).toBeInTheDocument();
  });

  it('shows an empty extraction state', () => {
    render(<TicketTable tickets={[]} />);
    expect(screen.getByRole('heading', { name: 'No extracted tickets' })).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<TicketTable tickets={[ticket]} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
