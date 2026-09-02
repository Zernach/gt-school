import '@testing-library/jest-dom/vitest';
import 'vitest-axe/extend-expect';

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
