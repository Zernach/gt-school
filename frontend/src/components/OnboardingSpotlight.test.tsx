import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { clearOnboardingIntroMemory, hasSeenOnboardingIntro, ONBOARDING_INTRO_STORAGE_KEY, rememberOnboardingIntro } from '../onboardingMemory';
import { onboardingIntroSteps } from '../onboardingStory';
import { OnboardingSpotlight } from './OnboardingSpotlight';

describe('OnboardingSpotlight', () => {
  beforeEach(() => {
    clearOnboardingIntroMemory();
  });

  it('renders the first-visit intro above the workspace copy', () => {
    render(<OnboardingSpotlight />);
    const intro = screen.getByRole('region', { name: 'Keystone intro' });
    expect(intro).toHaveClass('onboarding-spotlight');
    expect(within(intro).getByText(/no account needed/iu)).toBeInTheDocument();
    expect(within(intro).getByText(/You do not create an account/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /step 1 of 6/u })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('group', { name: 'Intro map' })).toBeInTheDocument();
  });

  it('does not render when local intro memory is already populated', () => {
    rememberOnboardingIntro('completed');
    render(<OnboardingSpotlight />);
    expect(screen.queryByRole('region', { name: 'Keystone intro' })).not.toBeInTheDocument();
  });

  it('moves the spotlight through the five workspace beats', async () => {
    const user = userEvent.setup();
    render(<OnboardingSpotlight />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[1]!.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin with what is verified/u })).toHaveAttribute('aria-current', 'step');
    await user.click(screen.getByRole('button', { name: /Bring family context into review/u }));
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[5]!.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter the workspace' })).toBeInTheDocument();
  });

  it('supports keyboard next, previous, home, and end without trapping the page', async () => {
    const user = userEvent.setup();
    render(<OnboardingSpotlight />);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[1]!.title })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[5]!.title })).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[0]!.title })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('heading', { name: onboardingIntroSteps[0]!.title })).toBeInTheDocument();
  });

  it('remembers a skipped intro in localStorage and unmounts the banner', async () => {
    const user = userEvent.setup();
    render(<main id="main-content" tabIndex={-1}><OnboardingSpotlight /></main>);
    await user.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(screen.queryByRole('button', { name: 'Skip intro' })).not.toBeInTheDocument();
    expect(hasSeenOnboardingIntro()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_INTRO_STORAGE_KEY) ?? '{}')).toMatchObject({ seen: true, outcome: 'dismissed' });
    await waitFor(() => expect(document.getElementById('main-content')).toHaveFocus());
  });

  it('remembers completion from the final step', async () => {
    const user = userEvent.setup();
    render(<OnboardingSpotlight />);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{End}');
    await user.click(screen.getByRole('button', { name: 'Enter the workspace' }));
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_INTRO_STORAGE_KEY) ?? '{}')).toMatchObject({ seen: true, outcome: 'completed' });
  });

  it('completes from the last step with ArrowRight', async () => {
    const user = userEvent.setup();
    render(<OnboardingSpotlight />);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{End}{ArrowRight}');
    expect(JSON.parse(window.localStorage.getItem(ONBOARDING_INTRO_STORAGE_KEY) ?? '{}')).toMatchObject({ seen: true, outcome: 'completed' });
  });

  it('dismisses from the close control', async () => {
    const user = userEvent.setup();
    render(<main id="main-content" tabIndex={-1}><OnboardingSpotlight /></main>);
    await user.click(screen.getByRole('button', { name: 'Dismiss intro' }));
    expect(hasSeenOnboardingIntro()).toBe(true);
    expect(screen.queryByRole('button', { name: 'Dismiss intro' })).not.toBeInTheDocument();
  });

  it('dismisses from Escape while a control inside the banner is focused', async () => {
    const user = userEvent.setup();
    render(<OnboardingSpotlight />);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Escape}');
    expect(hasSeenOnboardingIntro()).toBe(true);
  });

  it('does not repeat after remount when memory is populated', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingSpotlight />);
    await user.click(screen.getByRole('button', { name: 'Skip intro' }));
    unmount();
    render(<OnboardingSpotlight />);
    expect(screen.queryByRole('heading', { name: onboardingIntroSteps[0]!.title })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations on the first and last steps', async () => {
    const user = userEvent.setup();
    const { container } = render(<OnboardingSpotlight />);
    expect((await axe(container)).violations).toEqual([]);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{End}');
    expect((await axe(container)).violations).toEqual([]);
  });
});
