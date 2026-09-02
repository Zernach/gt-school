import { useEffect, useRef } from 'react';

const MAX_DEVICE_PIXEL_RATIO = 1.25;
const MAX_PIXEL_AREA = 900_000;

function resolveDevicePixelRatio(width: number, height: number): number {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const areaLimitedRatio = Math.sqrt(MAX_PIXEL_AREA / Math.max(width * height, 1));
  return Math.min(Math.max(0.75, devicePixelRatio), MAX_DEVICE_PIXEL_RATIO, Math.max(0.75, areaLimitedRatio));
}

/**
 * Keeps ambient onboarding motion outside React's render loop. The worker is
 * intentionally decorative: all navigation remains ordinary semantic HTML.
 */
export function OnboardingAmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;

    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const canUseWorkerCanvas =
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof canvas.transferControlToOffscreen === 'function';

    // The CSS background is a deliberately still, low-cost fallback.
    if (!canUseWorkerCanvas) return;

    let worker: Worker | null = null;
    let resizeFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const postResize = () => {
      if (!worker) return;
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      worker.postMessage({
        type: 'resize',
        width,
        height,
        devicePixelRatio: resolveDevicePixelRatio(width, height)
      });
    };

    const scheduleResize = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        postResize();
      });
    };

    const postMotionPreference = () => {
      worker?.postMessage({ type: 'motion', reducedMotion: motionQuery?.matches ?? false });
    };

    const postVisibility = () => {
      worker?.postMessage({ type: 'visibility', visible: document.visibilityState !== 'hidden' });
    };

    try {
      worker = new Worker(new URL('./onboarding-ambient.worker.ts', import.meta.url), {
        type: 'module',
        name: 'keystone-onboarding-ambient'
      });
      const offscreenCanvas = canvas.transferControlToOffscreen();
      worker.postMessage({
        type: 'init',
        canvas: offscreenCanvas,
        reducedMotion: motionQuery?.matches ?? false
      }, [offscreenCanvas]);
      postResize();
      postVisibility();

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(scheduleResize);
        resizeObserver.observe(canvas);
      }
      window.addEventListener('resize', scheduleResize);
      document.addEventListener('visibilitychange', postVisibility);
      motionQuery?.addEventListener?.('change', postMotionPreference);
    } catch {
      // Keep the static CSS fallback when a browser exposes partial canvas APIs.
      worker?.terminate();
      worker = null;
    }

    return () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      document.removeEventListener('visibilitychange', postVisibility);
      motionQuery?.removeEventListener?.('change', postMotionPreference);
      worker?.postMessage({ type: 'destroy' });
      worker?.terminate();
    };
  }, []);

  return <canvas ref={canvasRef} className="onboarding-ambient-canvas" aria-hidden="true" />;
}
