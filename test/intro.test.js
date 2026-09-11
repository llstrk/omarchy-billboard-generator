import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, attachment } from '../web/layout.js';
import { largePose, finalPose, introPose, introProgress, introFrame, introMapping, mappedBox, drawMappedImage } from '../web/intro.js';
import { createArtwork } from '../web/artwork.js';
import { buildWordmark } from '../src/wordmark.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function context() {
  return { font: '', measureText(text) {
    const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 34);
    return { width: [...text].length * size * .6, actualBoundingBoxAscent: size * .75, actualBoundingBoxDescent: size * .2 };
  } };
}
async function layout(width = 900, height = 240, suffix = '.DK') {
  return calculateLayout(context(), { width, height, wordmark: await buildWordmark(suffix),
    locale: { id: 'en', tagline: 'Beautiful, fun & agentic Linux by DHH' } });
}

test('intro fits both canvas dimensions, keeps official proportions and lands on the existing layout', async () => {
  for (const [width, height] of [[900, 240], [1920, 1080], [360, 640], [3840, 2160], [2000, 100], [641, 361], [2, 2]]) {
    for (const suffix of ['.DK', '.CO.UK', '.ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
      const l = await layout(width, height, suffix), large = largePose(l), small = finalPose(l);
      assert.ok(large.width >= small.width - 1e-8);
      near(large.width / large.height, 413.1 / 95);
      assert.ok(large.x >= 0 && large.y >= 0);
      assert.ok(large.x + large.width <= width + .5 && large.y + large.height <= height + .5);
      assert.ok(Math.abs(large.x + large.width / 2 - width / 2) <= .5);
      assert.ok(Math.abs(large.y + large.height / 2 - height / 2) <= .5);
      assert.deepEqual(introPose(l, 4.5), large);
      assert.deepEqual(introPose(l, 5), small);
      assert.equal(small.x, attachment(l, 0).x); assert.equal(small.y, l.top);
      let previous = large.width;
      for (let frame = 0; frame <= 125; frame++) {
        const pose = introPose(l, frame / 25);
        assert.ok(pose.width <= previous + 1e-8);
        near(pose.width / pose.height, 413.1 / 95);
        previous = pose.width;
      }
    }
  }
  near(largePose(await layout()).width, 840);
});

test('grading and movement share the half-second smootherstep, with a separate reveal clock', () => {
  for (const time of [0, 2, 4.28, 4.48, 4.5]) assert.equal(introProgress(time), 0);
  near(introProgress(4.75), .5);
  assert.equal(introProgress(5), 1); assert.equal(introProgress(15), 1);
  assert.ok(introProgress(4.52) > 0 && introProgress(4.52) < .001);
  assert.ok(introProgress(4.96) > .99);
  assert.equal(introFrame(0), 0); assert.equal(introFrame(113), 125);
  assert.equal(introFrame(124), 125); assert.equal(introFrame(374), 125);
  assert.equal(introFrame(107, 119), 119);
});

test('piecewise mapping pins canvas edges and wordmark boundaries without losing overscan', async () => {
  for (const dimensions of [[900, 240], [1920, 1080], [360, 640]]) {
    const l = await layout(...dimensions), small = finalPose(l);
    for (const time of [0, 4.5, 4.52, 4.75, 4.96, 5]) {
      const pose = introPose(l, time), mapping = introMapping(l, pose);
      near(mapping.x(0), 0); near(mapping.x(l.width), l.width);
      near(mapping.y(0), 0); near(mapping.y(l.height), l.height);
      near(mapping.x(small.x), pose.x); near(mapping.x(small.x + small.width), pose.x + pose.width);
      near(mapping.y(small.y), pose.y); near(mapping.y(small.y + small.height), pose.y + pose.height);
      assert.ok(mapping.x(-20) <= 0 && mapping.y(-20) <= 0);
      assert.ok(mapping.x(l.width + 20) >= l.width && mapping.y(l.height + 20) >= l.height);
      const box = mappedBox(mapping, small.x, small.y, small.width, small.height);
      assert.equal(box.x, pose.x); assert.equal(box.y, pose.y);
      near(box.cellW, pose.width); near(box.cellH, pose.height);
    }
  }
});

test('native image mapping splits at both logo boundaries rather than globally scaling margins', async () => {
  const l = await layout(), calls = [], image = {};
  const mapping = introMapping(l, largePose(l));
  const screen = { x: 0, y: 0, width: l.width, height: l.height };
  drawMappedImage({ drawImage: (...args) => calls.push(args) }, image, screen, screen, mapping);
  assert.equal(calls.length, 9);
  for (const args of calls) {
    assert.equal(args[0], image);
    assert.ok(args.slice(1).every(Number.isFinite));
    assert.ok(args[3] > 0 && args[4] > 0 && args[7] > 0 && args[8] > 0);
  }
  near(calls[4][7], largePose(l).width); near(calls[4][8], largePose(l).height);
});

test('moving artwork is directly rasterized with a one-pose cache and no oversized suffix allocation', async t => {
  const allocated = [];
  const original = globalThis.document;
  t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  globalThis.document = { createElement() {
    const rectangles = [], ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect: (...args) => rectangles.push(args) };
    const canvas = { getContext: () => ctx, rectangles }; allocated.push(canvas); return canvas;
  } };
  const wordmark = await buildWordmark('.ABCDEFGHIJKLMNOPQRSTUVWXYZ'), l = await layout(900, 240, '.ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const artwork = createArtwork({ wordmark, theme: { gradient: [{ from: 0, to: 100, color: '#abcdef' }] } }, l);
  const pose = largePose(l), moving = artwork.atPose(pose);
  assert.equal(moving.width, Math.ceil(pose.width));
  assert.equal(moving.rectangles.length, 211);
  assert.equal(artwork.atPose(pose), moving);
  assert.equal(artwork.atPose(finalPose(l)), artwork.base);
  assert.equal(allocated.length, 3);
  artwork.atPose(introPose(l, 4.75)); assert.equal(allocated.length, 4);
});
