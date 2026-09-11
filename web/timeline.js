export const FPS = 25, DEFAULT_DURATION = 15, MIN_DURATION = 10, MAX_DURATION = 30;
const phases = [
  ['effect', 'Animation', 0, 4.5], ['move', 'Wordmark move', 4.5, 5],
  ['tagline', 'Typing tagline', 5, 7], ['tagline-hold', 'Tagline hold', 7, 9.5],
  ['domain', 'Domain reveal', 9.5, 10.5], ['hold', 'Domain hold', 10.5, 15],
];
export function durationSeconds(value = DEFAULT_DURATION) {
  if (!['number', 'string'].includes(typeof value) || !/^(?:1\d|2\d|30)$/.test(String(value))) {
    throw Error('Duration must be a whole number of seconds from 10 to 30.');
  }
  return Number(value);
}
function phaseBoundaries(duration) {
  // Budget in integer twentieths of a second. This avoids rounding an exact
  // boundary such as 4.4s up to the wrong 25 fps frame due to floating point.
  const effect = Math.min(140, duration * 6), wait = Math.min(50, (duration - 5) * 5);
  return [0, effect, effect + 10, effect + 50, effect + 50 + wait, effect + 70 + wait, duration * 20];
}
export function videoTimeline(value = DEFAULT_DURATION) {
  const duration = durationSeconds(value), frameCount = duration * FPS, boundaries = phaseBoundaries(duration);
  return { duration, fps: FPS, frameCount, lastFrame: frameCount - 1, referenceDuration: DEFAULT_DURATION, policy: 'fixed-transitions-v1',
    phases: phases.map(([id, label, referenceStart, referenceEnd], i) => ({ id, label, referenceStart, referenceEnd,
      start: boundaries[i] / 20, end: boundaries[i + 1] / 20, duration: (boundaries[i + 1] - boundaries[i]) / 20,
      startFrame: boundaries[i] * FPS / 20,
      firstFrame: Math.ceil(boundaries[i] * FPS / 20), endFrame: Math.ceil(boundaries[i + 1] * FPS / 20) })) };
}
export function referenceFrame(timeline, index) {
  if (timeline.duration === DEFAULT_DURATION) return index;
  const phase = timeline.phases.find(p => index / FPS < p.end) ?? timeline.phases.at(-1);
  return phase.referenceStart * FPS + (index - phase.startFrame) * (phase.referenceEnd - phase.referenceStart) / phase.duration;
}
export const referenceTime = (timeline, index) => referenceFrame(timeline, index) / FPS;
export function phaseById(timeline, id) {
  return timeline.phases.find(phase => phase.id === id);
}
export function phaseLabel(timeline, index) {
  return timeline.phases.find(phase => index < phase.endFrame)?.label ?? 'Domain hold';
}
export function remapFrame(index, previous, next) {
  if (index === previous.lastFrame) return next.lastFrame;
  return Math.min(next.lastFrame, Math.round(index * next.frameCount / previous.frameCount));
}
// Sample the same native trajectory through the allocated opening and move.
// Canonical ground events are independent of output sampling density.
export function introSamples(timeline, last, accelerated = true) {
  const speed = accelerated ? 5 / 4.5 : 1;
  return Array.from({ length: phaseById(timeline, 'tagline').firstFrame }, (_, index) => Math.min(last, referenceFrame(timeline, index) * speed));
}
