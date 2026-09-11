import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { openRenderer } from '../src/render.js';
import { loadSnapshot } from '../src/snapshot.js';

const directory = '.cache/intro-tests'; await mkdir(directory, { recursive: true });
const snapshot = await loadSnapshot(), report = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  ['laseretch-campaign', 'hackerman', 'da', '.DK', 900, 240],
  ['sweep', 'ethereal', 'da', '.DK', 900, 240],
  ['sweep', 'ethereal', 'en', '.CO.UK', 360, 640],
  ['laseretch-campaign', 'white', 'ar', '.ORG', 900, 240],
  ['sweep', 'ethereal', 'ja', '.ORG', 1920, 1080],
];
const indices = [0, 70, 107, 112, 113, 118, 124, 125, 140, 160, 175, 237, 250, 263, 295];
const golden = JSON.parse(await readFile('test/fixtures/frame-hashes.json', 'utf8'));
for (const [animation, theme, language, tld, width, height] of cases) {
  const options = { animation, theme, language, tld, width, height }, renderer = await openRenderer(options, snapshot);
  const frames = {};
  try {
    const { intro } = renderer.layout;
    assert.equal(intro.moveStart, 4.5); assert.equal(intro.moveEnd, 5);
    assert.equal(intro.final.width, renderer.layout.baseWidth);
    assert.equal(intro.final.y, renderer.layout.top);
    assert.equal(intro.final.scale, renderer.layout.logoScale);
    for (const index of indices) frames[index] = hash(await renderer.frame(index));
    for (const index of [...indices].reverse()) assert.equal(hash(await renderer.frame(index)), frames[index]);
    assert.notEqual(frames[112], frames[118]); assert.notEqual(frames[118], frames[124]);
    if (animation === 'sweep') {
      assert.equal(frames[107], frames[112], 'Completed effect must not change grading before movement.');
      assert.equal(renderer.layout.settleMs, 500);
      const bounds = await renderer.page.evaluate(() => {
        window.renderFrame(112, false);
        const c = document.querySelector('canvas'), pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const bg = window.layout.settings.backgroundColor.match(/[a-f\d]{2}/gi).map(h => parseInt(h, 16));
        let left = c.width, right = -1, top = c.height, bottom = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (bg.every((v, channel) => v === pixels[i + channel])) continue;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        return { left, top, width: right - left + 1, height: bottom - top + 1 };
      });
      for (const [key, expected] of Object.entries({ left: intro.large.x, top: intro.large.y, width: intro.large.width, height: intro.large.height })) {
        assert.ok(Math.abs(bounds[key] - expected) <= 1, `${animation}: ${key} must follow the large pose`);
      }
    } else {
      assert.equal(renderer.layout.fixedGroundLayer, true);
      assert.equal(renderer.layout.nativeLaserTailClock, true);
      assert.equal(renderer.layout.sparkMetadata.piles.lastVisibleFrame, 161);
      const sparks = renderer.layout.sparkMetadata;
      assert.equal(sparks.groundEventCount, 773);
      assert.ok(sparks.piles.landings <= sparks.groundEventCount);
      assert.ok(sparks.groundEvents.every(e => e.extendedFrames === e.nativeFrames * 4));
    }
    if (theme === 'hackerman' && golden.browser === renderer.browserVersion && golden.revision === snapshot.commit) {
      for (const index of indices.filter(i => i >= 125)) assert.equal(frames[index], golden.frames[index], `Unchanged accepted final frame ${index}`);
    }
    await writeFile(`${directory}/${animation}-${theme}-${width}x${height}.png`, await renderer.frame(118));
    report.push({ options, frames, intro });
  } finally { await renderer.close(); }
  const fresh = await openRenderer(options, snapshot);
  try { assert.equal(hash(await fresh.frame(118)), frames[118], 'Fresh-session determinism'); }
  finally { await fresh.close(); }
}
await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log('Intro geometry, grading clock, seeking, native pile invariants and accepted final frames passed.');
