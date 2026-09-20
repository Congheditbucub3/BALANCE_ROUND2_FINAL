// lib/anticheat.js
// Mirrors the client-side heuristic in steptracker.js, but enforced server-side
// so a modified/bypassed client can't just claim arbitrary step counts.
//
// A submission is a batch: { delta, elapsedMs } — `delta` new steps claimed
// since the last submission, taken over `elapsedMs` milliseconds.
// Human walking cadence tops out well under 5 steps/sec even for running;
// treat anything sustained above that as spoofed motion events.

const MAX_STEPS_PER_SECOND = 4.5;
const MIN_ELAPSED_MS = 250; // guards against divide-by-near-zero on rapid double submits

function isPlausible(delta, elapsedMs) {
  if (delta <= 0) return { ok: true, delta: 0 };
  if (elapsedMs < MIN_ELAPSED_MS) return { ok: false, reason: 'submissions too frequent' };
  const stepsPerSecond = delta / (elapsedMs / 1000);
  if (stepsPerSecond > MAX_STEPS_PER_SECOND) {
    return { ok: false, reason: `implausible cadence: ${stepsPerSecond.toFixed(1)} steps/sec` };
  }
  return { ok: true, delta };
}

module.exports = { isPlausible, MAX_STEPS_PER_SECOND };
