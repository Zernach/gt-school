import { dashboardStory } from './components/dashboardStory';
import { onboardingIntroSteps, onboardingSatellites } from './onboardingStory';

describe('onboarding intro story', () => {
  it('walks through welcome plus the five home-screen accordions', () => {
    expect(onboardingIntroSteps.map((step) => step.id)).toEqual([
      'welcome',
      'overview',
      'conflicts',
      'groups',
      'proposals',
      'tickets'
    ]);
    expect(onboardingSatellites).toHaveLength(5);
    expect(onboardingIntroSteps[0]?.kicker).toMatch(/no account needed/iu);
    expect(onboardingIntroSteps[1]?.kicker).toBe(dashboardStory.overview.step);
    expect(onboardingIntroSteps[2]?.kicker).toBe(dashboardStory.conflicts.step);
    expect(onboardingIntroSteps[3]?.kicker).toBe(dashboardStory.groups.step);
    expect(onboardingIntroSteps[4]?.kicker).toBe(dashboardStory.proposals.step);
    expect(onboardingIntroSteps[5]?.kicker).toBe(dashboardStory.tickets.step);
  });

  it('keeps intro titles distinct from accordion headings', () => {
    const titles = onboardingIntroSteps.map((step) => step.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain(dashboardStory.overview.title);
    expect(titles).not.toContain(dashboardStory.conflicts.title);
    expect(titles).not.toContain(dashboardStory.groups.title);
    expect(titles).not.toContain(dashboardStory.proposals.title);
    expect(titles).not.toContain(dashboardStory.tickets.title);
  });

  it('states the no-account and no-source-write boundaries in copy', () => {
    const copy = onboardingIntroSteps.flatMap((step) => [step.summary, ...step.facts]).join(' ');
    expect(copy).toMatch(/do not create an account/iu);
    expect(copy).toMatch(/source systems remain unchanged/iu);
    expect(copy).toMatch(/synthetic/iu);
  });
});
