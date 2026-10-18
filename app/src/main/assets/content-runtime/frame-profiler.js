// Frame scheduling policy and phase timing for the game session.

export const MAX_STEPS_PER_FRAME = 3;

/** Fixed simulation steps to run this frame. A device that cannot keep up gets a
 * slower simulation instead of more steps per late frame: unbounded catch-up made
 * each slow frame slower still, which is how one heavy system froze the game. */
export function fixedSteps(accumulator, dt, fixedDt, max = MAX_STEPS_PER_FRAME) {
  let rest = accumulator + dt, steps = 0;
  while (rest >= fixedDt && steps < max) { rest -= fixedDt; steps++; }
  if (steps === max && rest > fixedDt) rest = fixedDt;
  return { steps, accumulator: rest };
}

/** Milliseconds of background work (chunk generation, meshing) this frame may use:
 * whatever the previous frame's own work left of the target, within limits. */
export function backgroundBudgetMs(previousWorkMs, { targetMs = 16, minMs = 1.5, maxMs = 6 } = {}) {
  return Math.max(minMs, Math.min(maxMs, targetMs - previousWorkMs));
}

/** Per-phase wall time of the frame loop (FERAL.perf). Off by default; when off a
 * phase costs one branch. Use start(), play, then report(). */
export class FrameProfiler {
  constructor() { this.enabled = false; this.phases = new Map(); this.frameMs = []; this.steps = 0; }
  start() { this.reset(); this.enabled = true; }
  stop() { const report = this.report(); this.enabled = false; return report; }
  reset() { this.phases.clear(); this.frameMs.length = 0; this.steps = 0; }
  mark() { return this.enabled ? performance.now() : 0; }
  add(name, since) {
    if (!this.enabled) return;
    const ms = performance.now() - since; let row = this.phases.get(name);
    if (!row) this.phases.set(name, row = { ms: 0, calls: 0, maxMs: 0 });
    row.ms += ms; row.calls++; if (ms > row.maxMs) row.maxMs = ms;
  }
  frame(ms, steps) { if (!this.enabled) return; this.frameMs.push(ms); this.steps += steps; }
  /** Averages per frame. frameMs is the frame loop's own work, not the GPU. */
  report() {
    const frames = this.frameMs.length, sorted = [...this.frameMs].sort((a, b) => a - b), per = (v) => frames ? v / frames : 0;
    return {
      frames, stepsPerFrame: per(this.steps),
      frameMs: { mean: per(this.frameMs.reduce((a, b) => a + b, 0)), p95: sorted[Math.floor(frames * .95)] ?? 0, max: sorted.at(-1) ?? 0 },
      phases: Object.fromEntries([...this.phases].sort((a, b) => b[1].ms - a[1].ms)
        .map(([name, r]) => [name, { msPerFrame: per(r.ms), callsPerFrame: per(r.calls), maxMs: r.maxMs }])),
    };
  }
}
