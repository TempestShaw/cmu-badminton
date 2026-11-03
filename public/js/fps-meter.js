// Developer aid, loaded only with ?fps in the address: a corner readout of
// frames per second, plus the slowest frame during the last animation, to
// check the motion keeps up with the screen (120 Hz on recent MacBooks).
const SAMPLE_MS = 500;

export function startFpsMeter() {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', right: '8px', bottom: '8px', zIndex: '100', padding: '4px 8px', borderRadius: '6px',
    font: '600 12px/1.3 ui-monospace, Menlo, monospace', background: 'rgba(0,0,0,0.75)', color: '#fff', pointerEvents: 'none',
  });
  document.body.append(box);
  let last = performance.now();
  let frames = 0;
  let windowStart = last;
  let fps = 0;
  let worst = 0;      // slowest frame while something animates
  let lastWorst = 0;  // shown after the animation ends
  const tick = (now) => {
    const frame = now - last;
    last = now;
    frames += 1;
    if (document.getAnimations().length) worst = Math.max(worst, frame);
    else if (worst) { lastWorst = worst; worst = 0; }
    if (now - windowStart >= SAMPLE_MS) {
      fps = Math.round((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;
      box.textContent = `${fps} fps · last animation's slowest frame ${lastWorst ? `${lastWorst.toFixed(1)} ms` : '–'}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
