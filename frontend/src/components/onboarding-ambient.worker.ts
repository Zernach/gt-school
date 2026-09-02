type Message =
  | { type: 'init'; canvas: OffscreenCanvas; reducedMotion: boolean }
  | { type: 'resize'; width: number; height: number; devicePixelRatio: number }
  | { type: 'motion'; reducedMotion: boolean }
  | { type: 'visibility'; visible: boolean }
  | { type: 'destroy' };

const FRAME_INTERVAL_MS = 1_000 / 24;
const STAR_COUNT = 36;
const stars = Array.from({ length: STAR_COUNT }, (_, index) => ({
  x: ((index * 67) % 97) / 97,
  y: ((index * 43 + 19) % 89) / 89,
  radius: 0.55 + ((index * 17) % 11) / 10,
  phase: index * 0.71
}));

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let width = 1;
let height = 1;
let canvasDevicePixelRatio = 1;
let elapsedSeconds = 0;
let lastFrameAt = 0;
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let reducedMotion = false;
let visible = true;

function stop() {
  if (frameTimer !== null) clearTimeout(frameTimer);
  frameTimer = null;
}

function draw() {
  if (!context) return;
  context.setTransform(canvasDevicePixelRatio, 0, 0, canvasDevicePixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const auroraX = width * (0.28 + Math.sin(elapsedSeconds * 0.12) * 0.14);
  const auroraY = height * (0.34 + Math.cos(elapsedSeconds * 0.1) * 0.1);
  const cyan = context.createRadialGradient(auroraX, auroraY, 0, auroraX, auroraY, Math.max(width, height) * 0.72);
  cyan.addColorStop(0, 'rgba(0, 229, 255, 0.19)');
  cyan.addColorStop(1, 'rgba(0, 229, 255, 0)');
  context.fillStyle = cyan;
  context.fillRect(0, 0, width, height);

  const purpleX = width * (0.7 + Math.cos(elapsedSeconds * 0.09) * 0.12);
  const purple = context.createRadialGradient(purpleX, height * 0.56, 0, purpleX, height * 0.56, Math.max(width, height) * 0.68);
  purple.addColorStop(0, 'rgba(155, 118, 209, 0.22)');
  purple.addColorStop(1, 'rgba(155, 118, 209, 0)');
  context.fillStyle = purple;
  context.fillRect(0, 0, width, height);

  for (const star of stars) {
    const opacity = 0.2 + (Math.sin(elapsedSeconds * 1.15 + star.phase) + 1) * 0.22;
    context.fillStyle = `rgba(238, 247, 255, ${opacity})`;
    context.beginPath();
    context.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
    context.fill();
  }
}

function render() {
  if (!visible || reducedMotion) return;
  const now = performance.now();
  elapsedSeconds += Math.min(Math.max((now - lastFrameAt) / 1_000, 0), 0.1);
  lastFrameAt = now;
  draw();
  frameTimer = setTimeout(render, FRAME_INTERVAL_MS);
}

function start() {
  stop();
  draw();
  if (!visible || reducedMotion) return;
  lastFrameAt = performance.now();
  frameTimer = setTimeout(render, FRAME_INTERVAL_MS);
}

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'init') {
    canvas = message.canvas;
    context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    reducedMotion = message.reducedMotion;
    start();
    return;
  }
  if (message.type === 'resize') {
    width = Math.max(message.width, 1);
    height = Math.max(message.height, 1);
    canvasDevicePixelRatio = Math.max(0.75, Math.min(message.devicePixelRatio, 1.25));
    if (canvas) {
      canvas.width = Math.max(Math.round(width * canvasDevicePixelRatio), 1);
      canvas.height = Math.max(Math.round(height * canvasDevicePixelRatio), 1);
    }
    start();
    return;
  }
  if (message.type === 'motion') {
    reducedMotion = message.reducedMotion;
    start();
    return;
  }
  if (message.type === 'visibility') {
    visible = message.visible;
    start();
    return;
  }
  stop();
  context = null;
  canvas = null;
  self.close();
};
