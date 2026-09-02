import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onboardingIntroSteps } from '../onboardingStory';
import { OnboardingConstellation } from './OnboardingConstellation';

describe('OnboardingConstellation', () => {
  it('exposes a keyboard-operable intro map for the hub and five workspace beats', () => {
    render(<OnboardingConstellation activeIndex={2} onSelect={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Intro map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${onboardingIntroSteps[0]!.title}, step 1 of 6` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${onboardingIntroSteps[2]!.title}, step 3 of 6` })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: `${onboardingIntroSteps[0]!.title}, step 1 of 6` })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(document.querySelector('canvas.onboarding-ambient-canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('notifies its owner when the hub or a satellite is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OnboardingConstellation activeIndex={0} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: `${onboardingIntroSteps[0]!.title}, step 1 of 6` }));
    await user.click(screen.getByRole('button', { name: `${onboardingIntroSteps[4]!.title}, step 5 of 6` }));
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(onSelect).toHaveBeenCalledWith(4);
  });
});
