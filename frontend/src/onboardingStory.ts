import { dashboardStory } from './components/dashboardStory';

export interface OnboardingIntroStep {
  id: string;
  kicker: string;
  title: string;
  summary: string;
  facts: readonly string[];
  satelliteLabel: string;
  target: 'hub' | 'overview' | 'conflicts' | 'groups' | 'proposals' | 'tickets';
}

export const onboardingIntroSteps: readonly OnboardingIntroStep[] = [
  {
    id: 'welcome',
    kicker: '00 · Welcome · no account needed',
    title: 'See the disagreement before anyone changes a record',
    summary: 'Keystone is a reconciliation trust layer for CRM, application, and payment data. This demo uses synthetic student and family records. You do not create an account, and source systems stay read-only.',
    facts: [
      'No sign-in, profile, or user record is created',
      'CRM, application, and payments are mirrored read-only',
      'Synthetic fixtures only — not live student data'
    ],
    satelliteLabel: 'Keystone',
    target: 'hub'
  },
  {
    id: 'overview',
    kicker: dashboardStory.overview.step,
    title: 'Begin with what is verified',
    summary: dashboardStory.overview.description,
    facts: [
      'Trust posture first: complete, incomplete, or needs investigation',
      'Unchecked evidence is labeled, never treated as a clean pass',
      'Counts come from the current read-only evidence window'
    ],
    satelliteLabel: 'Evidence',
    target: 'overview'
  },
  {
    id: 'conflicts',
    kicker: dashboardStory.conflicts.step,
    title: 'Inspect the exact mismatch',
    summary: dashboardStory.conflicts.description,
    facts: [
      'Each conflict is a versioned rule failure, not a hunch',
      'Open a row for values, field lineage, and audit history',
      'Unchecked means the rule could not run — not that it passed'
    ],
    satelliteLabel: 'Conflicts',
    target: 'conflicts'
  },
  {
    id: 'groups',
    kicker: dashboardStory.groups.step,
    title: 'Prioritize the pattern, not the noise',
    summary: dashboardStory.groups.description,
    facts: [
      'Related failures cluster into reviewable workstreams',
      'Start with the highest-volume pattern',
      'Then open one representative conflict'
    ],
    satelliteLabel: 'Patterns',
    target: 'groups'
  },
  {
    id: 'proposals',
    kicker: dashboardStory.proposals.step,
    title: 'Record a decision. Leave source systems untouched.',
    summary: dashboardStory.proposals.description,
    facts: [
      'Pending is not a fix — reviewers approve, reject, or hold',
      'Sensitive fields stay on hold until a person decides',
      'Source systems remain unchanged'
    ],
    satelliteLabel: 'Decisions',
    target: 'proposals'
  },
  {
    id: 'tickets',
    kicker: dashboardStory.tickets.step,
    title: 'Bring family context into review',
    summary: dashboardStory.tickets.description,
    facts: [
      'Tickets join student, household, and source records',
      'Support context informs review; it does not write back',
      'Auto-apply is a separate gated function'
    ],
    satelliteLabel: 'Support',
    target: 'tickets'
  }
] as const;

export const onboardingSatellites = onboardingIntroSteps.filter((step) => step.target !== 'hub');
