import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Accordion } from './Accordion';

function renderAccordion(defaultOpen = false) {
  return render(
    <Accordion id="test-accordion" title="Test details" headingId="test-heading" defaultOpen={defaultOpen} heading={<h2 id="test-heading">Test details</h2>}>
      <p>Hidden until opened.</p>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('starts closed unless requested otherwise and toggles its panel accessibly', async () => {
    const user = userEvent.setup();
    renderAccordion();
    const panel = document.getElementById('test-accordion-panel');
    expect(panel).toHaveAttribute('hidden');
    const toggle = screen.getByRole('button', { name: 'Expand Test details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'test-accordion-panel');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Collapse Test details' })).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getByText('Hidden until opened.')).toBeVisible();
  });

  it('honors an open default', () => {
    renderAccordion(true);
    expect(screen.getByRole('button', { name: 'Collapse Test details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hidden until opened.')).toBeVisible();
  });
});
