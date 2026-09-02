export const ONBOARDING_INTRO_STORAGE_KEY = 'keystone.onboarding.intro.seen.v1';

export type OnboardingIntroOutcome = 'completed' | 'dismissed';

export interface OnboardingIntroMemory {
  seen: true;
  seenAt: string;
  outcome: OnboardingIntroOutcome;
}

function localCache(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isOutcome(value: unknown): value is OnboardingIntroOutcome {
  return value === 'completed' || value === 'dismissed';
}

export function parseOnboardingIntroMemory(value: unknown): OnboardingIntroMemory | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.seen !== true) return null;
  return {
    seen: true,
    seenAt: typeof record.seenAt === 'string' ? record.seenAt : '',
    outcome: isOutcome(record.outcome) ? record.outcome : 'dismissed'
  };
}

export function readOnboardingIntroMemory(): OnboardingIntroMemory | null {
  const cache = localCache();
  if (!cache) return null;
  try {
    const raw = cache.getItem(ONBOARDING_INTRO_STORAGE_KEY);
    if (!raw) return null;
    return parseOnboardingIntroMemory(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function hasSeenOnboardingIntro(): boolean {
  return readOnboardingIntroMemory()?.seen === true;
}

export function rememberOnboardingIntro(outcome: OnboardingIntroOutcome): OnboardingIntroMemory | null {
  const memory: OnboardingIntroMemory = {
    seen: true,
    seenAt: new Date().toISOString(),
    outcome
  };
  const cache = localCache();
  if (!cache) return memory;
  try {
    cache.setItem(ONBOARDING_INTRO_STORAGE_KEY, JSON.stringify(memory));
    return memory;
  } catch {
    return memory;
  }
}

export function clearOnboardingIntroMemory(): void {
  try {
    localCache()?.removeItem(ONBOARDING_INTRO_STORAGE_KEY);
  } catch {
    /* private-mode and quota failures must not block the dashboard */
  }
}
