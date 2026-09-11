import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, effectMapping, cursorVerticalBox } from '../web/layout.js';
import { buildWordmark } from '../src/wordmark.js';

function context() {
  return { font: '', measureText(text) {
    const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 34);
    return { width: [...text].length * size * .6, actualBoundingBoxAscent: size * .75, actualBoundingBoxDescent: size * .2 };
  } };
}

test('the floor follows canvas height, including square, portrait and small canvases', async () => {
  const wordmark = await buildWordmark('.CO.UK');
  for (const [width, height] of [[900, 240], [900, 480], [1920, 1080], [720, 1280], [600, 600], [320, 96], [2000, 100], [501, 701], [2, 2]]) {
    const layout = calculateLayout(context(), { width, height, wordmark, locale: { id: 'en', tagline: 'Beautiful, fun & agentic Linux' } });
    assert.equal(layout.floorY, height - Math.min(height / 2, 6 * layout.unit));
    assert.ok(layout.floorY > height * .95 || height < 10);
    const mapping = effectMapping(layout, 5, 20);
    assert.ok(Math.abs(mapping.mapY(19) + layout.cellH / 2 - layout.floorY) < 1e-8, 'Final particle cell center meets the actual floor.');
    assert.ok(Math.abs(mapping.mapY(14) - (mapping.originY + 14 * layout.cellH)) < 1e-8, 'Logo rows must not stretch.');
    assert.ok(layout.fullWidth <= width);
    assert.ok(layout.top >= 0 && layout.baseline + layout.descent <= height + 1);
  }
});

test('cursor preserves its height and centers on capitals regardless of line descenders', () => {
  const layout = { fontSize: 34, ascent: 25, descent: 7, cursorCenterOffset: -12.5 };
  for (const line of [{ y: 215, ascent: 25, descent: 7 }, { y: 261, ascent: 23, descent: 0 }]) {
    const cursor = cursorVerticalBox(layout, line);
    assert.equal(cursor.height, 34);
    assert.equal(cursor.top + cursor.height / 2, line.y - 12.5);
  }
  assert.deepEqual(cursorVerticalBox(layout, { y: 215, ascent: 25, descent: 7 }), { top: 185.5, height: 34 });
  assert.deepEqual(cursorVerticalBox({ fontSize: 30, ascent: 32, descent: 8, cursorCenterOffset: -11 }, { y: 100 }), { top: 69, height: 40 });
});

test('long suffixes, small canvases and multiline copy warn rather than enforce layout gates', async () => {
  const layout = calculateLayout(context(), { width: 120, height: 60, wordmark: await buildWordmark('.ABCDEFGHIJKLMNOPQRSTUVWXYZ'), locale: { id: 'en', tagline: 'A very long experimental tagline that needs more room than this small canvas provides' } });
  assert.ok(layout.warnings.length);
  assert.ok(layout.fontSize > 0 && layout.logoHeight > 0);
});
