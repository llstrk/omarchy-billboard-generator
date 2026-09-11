import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoTimeline, durationSeconds, referenceFrame, referenceTime, remapFrame, introSamples, phaseById } from '../web/timeline.js';
import { introProgress, introPose } from '../web/intro.js';
import { parseOptions } from '../src/options.js';
import { loadSnapshot } from '../src/snapshot.js';
import { encodeFrames } from '../src/encoder.js';
import { verifyVideo } from '../src/video-verification.js';
import { createSimulation } from '../web/simulation.js';
import { checkSampleBudget } from '../web/website-simulation.js';

const snapshot = await loadSnapshot();
test('all 21 whole-second durations are accepted and everything else is rejected', () => {
  assert.equal(durationSeconds(), 15);
  for (let duration = 10; duration <= 30; duration++) {
    assert.equal(durationSeconds(String(duration)), duration);
    assert.equal(parseOptions(['--duration', String(duration)], snapshot).duration, duration);
  }
  for (const value of [9, 31, 10.5, 29.9, 0, -10, Infinity, NaN, null, true, false, {}, [], '', '10.0', '1e1', '010', '15x', ' 15']) {
    assert.throws(() => durationSeconds(value), /whole number.*10 to 30/);
  }
  for (const command of ['sync', '--list-themes', '--list-languages', '--list-animations']) {
    assert.throws(() => parseOptions([command, '--duration', '20'], snapshot), /cannot be combined/);
  }
});

test('phases partition every frame and move/grading stay on the same reference clock', () => {
  const layout = { width: 900, height: 240, padding: 30, baseWidth: 600, logoHeight: 140, logoScale: 1.4, top: 20, tailWidth: 200 };
  for (let duration = 10; duration <= 30; duration++) {
    const timeline = videoTimeline(duration);
    assert.equal(timeline.frameCount, duration * 25);
    assert.equal(timeline.lastFrame, timeline.frameCount - 1);
    let boundary = 0;
    for (const phase of timeline.phases) {
      assert.equal(phase.firstFrame, boundary);
      assert.ok(phase.endFrame > phase.firstFrame);
      boundary = phase.endFrame;
    }
    assert.equal(boundary, timeline.frameCount);
    const move = phaseById(timeline, 'move');
    assert.equal(move.duration, .5);
    assert.equal(phaseById(timeline, 'tagline').duration, 2);
    assert.equal(phaseById(timeline, 'domain').duration, 1);
    assert.ok(phaseById(timeline, 'effect').duration <= 7);
    assert.ok(phaseById(timeline, 'tagline-hold').duration <= 2.5);
    for (const id of ['move', 'tagline', 'domain']) {
      const phase = phaseById(timeline, id);
      for (const fraction of [0, .2, .5, .9]) {
        const elapsed = phase.duration * fraction;
        assert.ok(Math.abs(referenceTime(timeline, (phase.start + elapsed) * 25) - phase.referenceStart - elapsed) < 1e-10, `${duration}s: ${id} must retain real-time speed`);
      }
    }
    for (const phase of timeline.phases) {
      assert.ok(referenceTime(timeline, phase.firstFrame) >= phase.referenceStart - 1e-10);
      if (phase.firstFrame) assert.ok(referenceTime(timeline, phase.firstFrame - 1) < phase.referenceStart);
    }
    const midMoveFrame = (move.start + .25) * 25;
    const time = referenceTime(timeline, midMoveFrame);
    assert.ok(Math.abs(introProgress(time) - .5) < 1e-12);
    const pose = introPose(layout, time), expected = introPose(layout, 4.75);
    for (const key of Object.keys(expected)) assert.ok(Math.abs(pose[key] - expected[key]) < 1e-8);
    assert.ok(referenceTime(timeline, timeline.lastFrame) >= 10.5);
    const samples = introSamples(timeline, 125);
    assert.equal(samples.length, phaseById(timeline, 'tagline').firstFrame);
    assert.ok(samples.every((p, i) => p >= 0 && p <= 125 && (!i || p >= samples[i - 1])));
  }
  const normal = videoTimeline();
  for (let i = 0; i < 375; i++) {
    assert.equal(referenceFrame(normal, i), i);
    assert.equal(referenceTime(normal, i), i / 25);
  }
  assert.equal(introSamples(videoTimeline(30), 125).length, 188);
  assert.deepEqual(videoTimeline(10).phases.map(p => p.duration), [3, .5, 2, 1.25, 1, 2.25]);
  assert.deepEqual(videoTimeline(15).phases.map(p => p.duration), [4.5, .5, 2, 2.5, 1, 4.5]);
  assert.deepEqual(videoTimeline(30).phases.map(p => p.duration), [7, .5, 2, 2.5, 1, 17]);
  assert.equal(phaseById(videoTimeline(13), 'tagline').firstFrame, 110, '4.4 seconds must not round up to frame111.');
});

test('duration edits preserve proportional progress and the completed frame', () => {
  assert.equal(remapFrame(100, videoTimeline(10), videoTimeline(30)), 300);
  assert.equal(remapFrame(300, videoTimeline(30), videoTimeline(10)), 100);
  assert.equal(remapFrame(249, videoTimeline(10), videoTimeline(30)), 749);
  assert.equal(remapFrame(749, videoTimeline(30), videoTimeline(15)), 374);
});

test('encoder submits exactly the selected frame count and reports the correct denominator', async () => {
  for (let duration = 10; duration <= 30; duration++) {
    const timeline = videoTimeline(duration), submitted = [], progress = []; let finished = false;
    await encodeFrames({ layout: { timeline }, frame: async i => i },
      { write: async frame => submitted.push(frame), finish: async () => { finished = true; } }, undefined, text => progress.push(text));
    assert.equal(submitted.length, timeline.frameCount);
    assert.equal(submitted.at(-1), timeline.lastFrame);
    assert.ok(finished); assert.ok(progress.every(p => p.endsWith(`/${timeline.frameCount}`)));
  }
});

test('long native playback samples new states without altering canonical floor inputs', async () => {
  const fetchAsset = async path => new Response(await readFile(new URL('..' + path, import.meta.url)));
  const normal = await createSimulation(fetchAsset), long = await createSimulation(fetchAsset, videoTimeline(30));
  const hash = frame => {
    const digest = createHash('sha256');
    for (const data of [frame.symbols, frame.fg, frame.bg, frame.flags]) digest.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return digest.digest('hex');
  };
  for (const key of ['primary', 'secondary']) {
    assert.deepEqual(long[key].frames.map(hash), normal[key].frames.map(hash));
    const canonical = new Set(normal[key].frames.map(hash));
    assert.equal(long.playback[key].length, 188);
    assert.ok(long.playback[key].some(frame => !canonical.has(hash(frame))), 'Denser playback must contain native states absent from the old frame cache.');
  }
});

test('website sampling has a duration-aware memory ceiling before caching frames', () => {
  const frame = { width: 200, height: 500 };
  assert.throws(() => checkSampleBudget(frame, 1000, Array(250)), /memory budget/);
  assert.doesNotThrow(() => checkSampleBudget(frame, 1000, Array(120)));
  assert.doesNotThrow(() => checkSampleBudget(frame, 10, Array(250)));
});

test('verification checks the requested duration and frame count rather than trusting metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'duration-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const probe = join(directory, 'ffprobe');
  const stream = { codec_name: 'h264', pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', avg_frame_rate: '25/1' };
  async function fixture(duration, frames = duration * 25) {
    const data = { streams: [{ ...stream, nb_read_frames: String(frames) }], format: { duration: String(duration) } };
    await writeFile(probe, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(data))});\n`, { mode: 0o755 });
  }
  for (let duration = 10; duration <= 30; duration++) {
    await fixture(duration); await verifyVideo('not-read', probe, { duration });
  }
  await fixture(30); await assert.rejects(verifyVideo('not-read', probe, { duration: 15 }), /format validation/);
  await fixture(10, 249); await assert.rejects(verifyVideo('not-read', probe, { duration: 10 }), /format validation/);
  await fixture('not-a-number', 250); await assert.rejects(verifyVideo('not-read', probe, { duration: 10 }), /format validation/);
});
