import { useState, type KeyboardEvent } from 'react';
import { hasSeenOnboardingIntro, rememberOnboardingIntro } from '../onboardingMemory';
import { onboardingIntroSteps } from '../onboardingStory';
import { OnboardingConstellation } from './OnboardingConstellation';

export function OnboardingSpotlight() {
  const [visible, setVisible] = useState(() => !hasSeenOnboardingIntro());
  const [stepIndex, setStepIndex] = useState(0);

  if (!visible) return null;

  const step = onboardingIntroSteps[stepIndex];
  if (!step) return null;
  const lastIndex = onboardingIntroSteps.length - 1;
  const isLast = stepIndex >= lastIndex;

  const close = (outcome: 'completed' | 'dismissed') => {
    rememberOnboardingIntro(outcome);
    setVisible(false);
    requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus({ preventScroll: true });
    });
  };

  const goTo = (index: number) => {
    setStepIndex(Math.min(lastIndex, Math.max(0, index)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close('dismissed');
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (isLast) close('completed');
      else goTo(stepIndex + 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(stepIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      goTo(lastIndex);
    }
  };

  return (
    <section
      className="onboarding-spotlight"
      data-step={step.target}
      aria-label="Keystone intro"
      aria-describedby="onboarding-summary"
      onKeyDown={onKeyDown}
    >
      <p className="sr-only" aria-live="polite">
        {`Intro step ${stepIndex + 1} of ${onboardingIntroSteps.length}: ${step.title}`}
      </p>
      <div className="onboarding-spotlight-frame">
        <OnboardingConstellation activeIndex={stepIndex} onSelect={goTo} />
        <div className="onboarding-copy">
          <p className="eyebrow">{step.kicker}</p>
          <h2 id="onboarding-heading">{step.title}</h2>
          <p id="onboarding-summary" className="onboarding-summary">{step.summary}</p>
          <ul className="onboarding-facts">
            {step.facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
          <div className="onboarding-controls">
            <p className="onboarding-progress" aria-hidden="true">{stepIndex + 1} / {onboardingIntroSteps.length}</p>
            <button type="button" className="secondary-button" onClick={() => close('dismissed')}>Skip intro</button>
            <button type="button" className="secondary-button" onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0}>Back</button>
            <button type="button" className="primary-button" onClick={() => (isLast ? close('completed') : goTo(stepIndex + 1))}>
              {isLast ? 'Enter the workspace' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
      <button type="button" className="icon-button onboarding-dismiss" aria-label="Dismiss intro" onClick={() => close('dismissed')}>
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
