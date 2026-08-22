import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { humanize, StatusBadge } from './StatusBadge';

describe('humanize', () => {
  it.each([
    ['paid_but_no_deal', 'Paid But No Deal'],
    ['oscillation_hold', 'Oscillation Hold'],
    ['active', 'Active'],
    ['already Human', 'Already Human'],
    ['', '']
  ])('maps %j to %j', (value, expected) => {
    expect(humanize(value)).toBe(expected);
  });

  it('does not mutate the supplied status text', () => {
    const value = 'sensitive_field_only_fix';
    humanize(value);
    expect(value).toBe('sensitive_field_only_fix');
  });
});

describe('StatusBadge', () => {
  it.each([
    ['complete', '✓', 'Complete'],
    ['active', '!', 'Active'],
    ['pending', '◷', 'Pending'],
    ['approved', '✓', 'Approved'],
    ['applied', '✓', 'Applied'],
    ['rejected', '×', 'Rejected'],
    ['held', '‖', 'Held'],
    ['oscillation_hold', '↺', 'Oscillation Hold'],
    ['partial', '△', 'Partial'],
    ['failed', '×', 'Failed'],
    ['unchecked', '?', 'Unchecked'],
    ['resolved', '✓', 'Resolved'],
    ['low', '↓', 'Low']
  ])('renders %s with non-color symbol %s and text', (status, symbol, label) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    const badge = container.querySelector('.status-badge');
    expect(badge).toHaveClass(`status-${status}`);
    expect(container.querySelector('.status-symbol')).toHaveTextContent(symbol);
  });

  it('uses a visible fallback symbol for an unknown future status', () => {
    const { container } = render(<StatusBadge status="future_state" />);
    expect(screen.getByText('Future State')).toBeInTheDocument();
    expect(container.querySelector('.status-symbol')).toHaveTextContent('•');
  });

  it('uses a supplied business label without exposing implementation text', () => {
    render(<StatusBadge status="pending" label="Refreshing evidence" />);
    expect(screen.getByText('Refreshing evidence')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('hides the redundant symbol from assistive technology', () => {
    const { container } = render(<StatusBadge status="failed" />);
    expect(container.querySelector('.status-symbol')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<StatusBadge status="oscillation_hold" label="Oscillation hard hold" />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
