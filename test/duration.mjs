import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openRenderer, renderVideo, executable } from '../src/render.js';
import { loadSnapshot } from '../src/snapshot.js';
import { videoTimeline, phaseById } from '../web/timeline.js';

const directory = '.cache/duration'; await mkdir(directory, { recursive: true });
const snapshot = await loadSnapshot(), reports = [];
const defaults = { theme: 'hackerman', language: 'da', tld: '.DK', width: 900, height: 240 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let finalHash, ground;
for (let duration = 10; duration <= 30; duration++) {
  for (const animation of ['laseretch-campaign', 'sweep']) {
    const renderer = await openRenderer({ ...defaults, animation, duration }, snapshot);
    try {
      const timeline = videoTimeline(duration);
      assert.deepEqual(renderer.layout.timeline, timeline);
      const move = phaseById(timeline, 'move'), typing = phaseById(timeline, 'tagline'), hold = phaseById(timeline, 'hold');
      const moveFrame = Math.floor((move.start + .25) * 25);
      const stillFrame = Math.ceil((Math.ceil(hold.start - typing.end) + typing.end + .75) * 25);
      assert.equal(renderer.layout.intro.moveStart, move.start);
      assert.equal(renderer.layout.intro.moveEnd, move.end);
      assert.equal(move.duration, .5);
      if (duration === 30) assert.equal(renderer.layout.animationSamples, 188, 'Long intros need denser simulation samples.');
      if (animation === 'laseretch-campaign') {
        ground ??= renderer.layout.sparkMetadata;
        assert.deepEqual(renderer.layout.sparkMetadata, ground, 'Changing output cadence must not change native landing events or packing.');
      }
      const indices = [...new Set([0, Math.floor(timeline.frameCount * .14), ...timeline.phases.map(p => p.firstFrame),
        moveFrame, stillFrame, timeline.lastFrame])];
      const hashes = {};
      for (const index of indices) hashes[index] = hash(await renderer.frame(index));
      for (const index of [...indices].reverse()) assert.equal(hash(await renderer.frame(index)), hashes[index], 'Seeking must be deterministic.');
      const holdStart = hashes[hold.firstFrame];
      assert.equal(hash(await renderer.frame(hold.firstFrame + 25)), holdStart, 'Cursor blinking must retain a one-second period.');
      assert.notEqual(hash(await renderer.frame(hold.firstFrame + 13)), holdStart, 'Cursor must still blink during long holds.');
      finalHash ??= hashes[stillFrame];
      assert.equal(hashes[stillFrame], finalHash, 'Final artwork remains unchanged at a cursor-off hold frame.');
      await assert.rejects(renderer.frame(timeline.frameCount), /Frame index/);
      await assert.rejects(renderer.frame(-1), /Frame index/);
      if ([10, 15, 30].includes(duration)) {
        await writeFile(`${directory}/${animation}-${duration}-move.png`, await renderer.frame(moveFrame));
      }
      reports.push({ duration, animation, timeline, hashes });
    } finally { await renderer.close(); }
  }
  const animation = duration % 2 ? 'sweep' : 'laseretch-campaign';
  const result = await renderVideo({ ...defaults, width: 320, height: 96, animation, duration,
    output: `${directory}/duration-${duration}.mp4`, force: true }, snapshot, { progress: () => {}, warn: () => {} });
  const metadata = JSON.parse(result.verified.format.tags.comment);
  assert.equal(metadata.duration, duration); assert.equal(metadata.frameCount, duration * 25);
  assert.deepEqual(metadata.timeline, videoTimeline(duration));
  execFileSync(await executable(process.env.BILLBOARD_FFMPEG, ['ffmpeg'], 'ffmpeg'),
    ['-v', 'error', '-xerror', '-i', result.output, '-f', 'null', '-'], { timeout: 60000 });
  console.log(`${duration}s: both engines seek correctly, unchanged canonical ground events, ${duration * 25} encoded frames fully decoded.`);
}
for (const duration of [10, 15, 30]) {
  for (const animation of ['laseretch-campaign', 'sweep']) {
    const renderer = await openRenderer({ ...defaults, duration, animation }, snapshot);
    try {
      const previous = reports.find(r => r.duration === duration && r.animation === animation);
      for (const [index, expected] of Object.entries(previous.hashes)) assert.equal(hash(await renderer.frame(Number(index))), expected);
    } finally { await renderer.close(); }
  }
}
await writeFile(`${directory}/report.json`, JSON.stringify(reports, null, 2) + '\n');
console.log('All 21 durations passed renderer, frame-count, metadata, full decode and deterministic timing checks.');
