import {
  clearOnboardingIntroMemory,
  hasSeenOnboardingIntro,
  ONBOARDING_INTRO_STORAGE_KEY,
  parseOnboardingIntroMemory,
  readOnboardingIntroMemory,
  rememberOnboardingIntro
} from './onboardingMemory';

describe('onboarding intro memory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('treats a missing cache as unseen', () => {
    expect(hasSeenOnboardingIntro()).toBe(false);
    expect(readOnboardingIntroMemory()).toBeNull();
  });

  it('persists a completed intro in localStorage, not sessionStorage', () => {
    const memory = rememberOnboardingIntro('completed');
    expect(memory).toMatchObject({ seen: true, outcome: 'completed' });
    expect(hasSeenOnboardingIntro()).toBe(true);
    expect(window.sessionStorage.getItem(ONBOARDING_INTRO_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_INTRO_STORAGE_KEY)).toContain('"seen":true');
  });

  it('persists a dismissed intro so the banner does not repeat', () => {
    rememberOnboardingIntro('dismissed');
    expect(readOnboardingIntroMemory()?.outcome).toBe('dismissed');
    expect(hasSeenOnboardingIntro()).toBe(true);
  });

  it('accepts a seen record even when optional fields are missing', () => {
    window.localStorage.setItem(ONBOARDING_INTRO_STORAGE_KEY, JSON.stringify({ seen: true }));
    expect(hasSeenOnboardingIntro()).toBe(true);
    expect(readOnboardingIntroMemory()).toEqual({ seen: true, seenAt: '', outcome: 'dismissed' });
  });

  it('ignores corrupt cache values instead of throwing', () => {
    window.localStorage.setItem(ONBOARDING_INTRO_STORAGE_KEY, '{not-json');
    expect(hasSeenOnboardingIntro()).toBe(false);
    expect(parseOnboardingIntroMemory(null)).toBeNull();
    expect(parseOnboardingIntroMemory({ seen: false })).toBeNull();
    expect(parseOnboardingIntroMemory('seen')).toBeNull();
  });

  it('still hides the intro in-session when localStorage writes fail', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const memory = rememberOnboardingIntro('completed');
    expect(memory?.seen).toBe(true);
    setItem.mockRestore();
  });

  it('treats localStorage as unseen when the cache cannot be read', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasSeenOnboardingIntro()).toBe(false);
    getItem.mockRestore();
  });

  it('clears stored intro memory', () => {
    rememberOnboardingIntro('completed');
    clearOnboardingIntroMemory();
    expect(hasSeenOnboardingIntro()).toBe(false);
  });
});
