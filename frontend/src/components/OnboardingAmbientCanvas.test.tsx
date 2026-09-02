import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingAmbientCanvas } from './OnboardingAmbientCanvas';

const originalTransferControl = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'transferControlToOffscreen');

afterEach(() => {
  if (originalTransferControl) Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', originalTransferControl);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen');
  vi.unstubAllGlobals();
});

describe('OnboardingAmbientCanvas', () => {
  it('hands ambient animation to a worker and tears it down with the spotlight', () => {
    const workers: Array<{ postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = [];
    const offscreenCanvas = {} as OffscreenCanvas;
    const transferControlToOffscreen = vi.fn(() => offscreenCanvas);

    class WorkerMock {
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }

    vi.stubGlobal('Worker', WorkerMock);
    vi.stubGlobal('OffscreenCanvas', class {});
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: transferControlToOffscreen
    });

    const { container, unmount } = render(<OnboardingAmbientCanvas />);
    const worker = workers[0];
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(transferControlToOffscreen).toHaveBeenCalledOnce();
    expect(worker?.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init', canvas: offscreenCanvas }), [offscreenCanvas]);
    expect(worker?.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize' }));
    expect(worker?.postMessage).toHaveBeenCalledWith({ type: 'visibility', visible: true });

    unmount();
    expect(worker?.postMessage).toHaveBeenCalledWith({ type: 'destroy' });
    expect(worker?.terminate).toHaveBeenCalledOnce();
  });
});
