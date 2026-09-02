import { onboardingIntroSteps, onboardingSatellites } from '../onboardingStory';

interface OnboardingConstellationProps {
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function OnboardingConstellation({ activeIndex, onSelect }: OnboardingConstellationProps) {
  const total = onboardingIntroSteps.length;
  const welcomeTitle = onboardingIntroSteps[0]?.title ?? 'Welcome';

  return (
    <div className="onboarding-stage">
      <div className="onboarding-aurora" aria-hidden="true" />
      <div className="onboarding-starfield" aria-hidden="true" />
      <div className="onboarding-constellation" role="group" aria-label="Intro map">
        <div className="onboarding-hub">
          <div className="onboarding-beam" data-target={onboardingIntroSteps[activeIndex]?.target ?? 'hub'} aria-hidden="true" />
          <svg className="onboarding-orbits" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="onboarding-orbit-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#9b76d1" stopOpacity="0.75" />
              </linearGradient>
            </defs>
            <ellipse className="onboarding-orbit onboarding-orbit-a" cx="160" cy="90" rx="118" ry="46" />
            <ellipse className="onboarding-orbit onboarding-orbit-b" cx="160" cy="90" rx="84" ry="32" />
            <ellipse className="onboarding-orbit onboarding-orbit-c" cx="160" cy="90" rx="52" ry="18" />
          </svg>
          <button
            type="button"
            className={`onboarding-gem${activeIndex === 0 ? ' is-active' : ''}`}
            {...(activeIndex === 0 ? { 'aria-current': 'step' as const } : {})}
            aria-label={`${welcomeTitle}, step 1 of ${total}`}
            onClick={() => onSelect(0)}
          >
            <span className="onboarding-gem-core" aria-hidden="true" />
            <span className="onboarding-gem-label">Keystone</span>
          </button>
        </div>
        <ol className="onboarding-satellites">
          {onboardingSatellites.map((step, index) => {
            const stepIndex = index + 1;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  className={`onboarding-satellite${activeIndex === stepIndex ? ' is-active' : ''}${activeIndex > stepIndex ? ' is-seen' : ''}`}
                  {...(activeIndex === stepIndex ? { 'aria-current': 'step' as const } : {})}
                  aria-label={`${step.title}, step ${stepIndex + 1} of ${total}`}
                  onClick={() => onSelect(stepIndex)}
                >
                  <span className="onboarding-satellite-node" aria-hidden="true" />
                  <span className="onboarding-satellite-label">{step.satelliteLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
