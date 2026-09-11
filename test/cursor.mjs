import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openRenderer } from '../src/render.js';
import { loadSnapshot } from '../src/snapshot.js';

const snapshot = await loadSnapshot(), directory = '.cache/cursor-alignment';
await mkdir(directory, { recursive: true });
const report = [];
async function capitalPixelCenters(renderer, cursor) {
  return renderer.page.evaluate(cursor => {
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const baseline = window.layout.lines.at(-1).y, size = window.layout.fontSize;
    function center(left, right) {
      let top = canvas.height, bottom = -1;
      for (let y = Math.max(0, Math.floor(baseline - size * 1.5)); y < Math.min(canvas.height, Math.ceil(baseline + size)); y++) {
        for (let x = Math.ceil(left); x < Math.floor(right); x++) {
          const i = (y * canvas.width + x) * 4;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 80) continue;
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (bottom < top) throw Error('Missing cursor or capital-letter pixels.');
      return (top + bottom + 1) / 2;
    }
    const right = cursor.x - window.layout.cursorGap;
    return { text: center(right - ctx.measureText('DHH').width, right), cursor: center(cursor.x, cursor.x + cursor.width) };
  }, cursor);
}
const cases = [
  ['en', 900, 240], ['da', 900, 240], ['ar', 900, 240], ['ja', 900, 480], ['hi', 900, 240], ['en', 1920, 1080], ['en', 900, 480],
];
for (const [language, width, height] of cases) {
  const wrapped = language === 'en' && height === 480;
  const selected = wrapped ? { ...snapshot, languages: snapshot.languages.map(locale => locale.id === 'en' ? {
    ...locale, tagline: 'Tall letters ABC and gentle descenders. Mixed words with happy glyphs. '.repeat(5).trim(),
  } : locale) } : snapshot;
  const renderer = await openRenderer({ theme: 'hackerman', language, tld: '.DK', width, height }, selected);
  try {
    const observations = await renderer.page.evaluate(() => {
      const ctx = document.querySelector('canvas').getContext('2d'), original = ctx.fillRect;
      const segmenter = new Intl.Segmenter(window.layout.settings.language, { granularity: 'grapheme' });
      const counts = window.layout.lines.map(line => [...segmenter.segment(line.text)].length);
      const total = counts.reduce((sum, count) => sum + count, 0), result = [];
      for (let index = 125; index <= 175; index++) {
        let box;
        ctx.fillRect = (x, y, width, height) => { box = { x, y, width, height }; return original.call(ctx, x, y, width, height); };
        try { window.renderFrame(index, false); } finally { ctx.fillRect = original; }
        let remaining = Math.floor(Math.min(1, (index / 25 - 5) / 2) * total), active = 0;
        while (active < counts.length - 1 && remaining > counts[active]) remaining -= counts[active++];
        const line = window.layout.lines[active], metrics = ctx.measureText('DHH');
        result.push({ index, active, box, cursorWidth: window.layout.cursorWidth,
          expectedHeight: Math.max(window.layout.fontSize, window.layout.ascent + window.layout.descent),
          textCenter: line.y + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2 });
      }
      return result;
    });
    const tops = new Map();
    for (const { active, box, cursorWidth, expectedHeight, textCenter } of observations) {
      assert.equal(box.width, cursorWidth, 'The intercepted rectangle must be the cursor.');
      assert.equal(box.height, expectedHeight, 'Keep the existing cursor height.');
      assert.ok(Math.abs(box.y + box.height / 2 - textCenter) < 1e-8, `${language}: cursor center must match the adjacent capital-letter body, excluding descenders.`);
      if (tops.has(active)) assert.equal(box.y, tops.get(active), 'Cursor must not bob as letters appear.');
      tops.set(active, box.y);
    }
    if (wrapped) { assert.ok(renderer.layout.lines.length > 1); assert.equal(tops.size, renderer.layout.lines.length); }
    if (!wrapped && ['en', 'da'].includes(language)) {
      const centers = await capitalPixelCenters(renderer, observations.at(-1).box);
      assert.ok(Math.abs(centers.text - centers.cursor) <= .5, 'Rendered DHH and cursor pixel centers must align, not just whole-line metrics.');
    }
    await writeFile(`${directory}/${language}-${width}x${height}-175.png`, await renderer.frame(175));
    report.push({ language, width, height, wrapped, observations });
  } finally { await renderer.close(); }
}
await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log('Cursor centers match capital-letter bodies throughout typing, independent of descenders, including RTL, CJK, tall scripts and wrapping.');
