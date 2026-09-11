import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { animations } from '../src/animations.js';
import { openRenderer } from '../src/render.js';
import { loadSnapshot } from '../src/snapshot.js';

const snapshot = await loadSnapshot(), reports = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { width: 900, height: 240, theme: 'hackerman', language: 'en', tld: '.ORG' };
let final;
for (const animation of animations.filter(a => a.origin === 'website')) {
  for (const duration of [10, 30]) {
    const renderer = await openRenderer({ ...options, animation: animation.id, duration }, snapshot);
    try {
      const count = duration * 25, hashes = {};
      const middle = Math.floor((renderer.layout.intro.moveStart + .25) * 25);
      for (const index of [0, Math.floor(count * .2), middle, ...renderer.layout.timeline.phases.map(p => p.firstFrame), count - 1]) {
        hashes[index] = hash(await renderer.frame(index));
      }
      final ??= hashes[count - 1]; assert.equal(hashes[count - 1], final, `${animation.id}: final artwork`);
      assert.equal(hash(await renderer.frame(middle)), hashes[middle], `${animation.id}: reverse seeking`);
      reports.push({ animation: animation.id, duration, samples: renderer.layout.animationSamples, hashes });
    } finally { await renderer.close(); }
  }
  console.log(`${animation.id}: 10- and 30-second clocks passed.`);
}
for (const selection of [
  { animation: 'laseretch-campaign', theme: 'white', language: 'ar', width: 900, height: 240 },
  { animation: 'fireworks', theme: 'astral', language: 'ja', width: 360, height: 640 },
  { animation: 'waves', theme: 'hackerman', language: 'en', width: 3840, height: 2160 },
]) {
  const renderer = await openRenderer({ ...options, ...selection, duration: 30 }, snapshot);
  try { for (const index of [70, 175, 181, 187, 188, 230, 300, 325, 749]) assert.ok((await renderer.frame(index)).length); }
  finally { await renderer.close(); }
}
await mkdir('.cache/duration', { recursive: true });
await writeFile('.cache/duration/effects-report.json', JSON.stringify(reports, null, 2) + '\n');
console.log('All 37 website effects passed both duration endpoints, with additional light/RTL, portrait/CJK and 4K checks.');
