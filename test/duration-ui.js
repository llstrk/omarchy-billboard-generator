import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openRenderer } from '../src/render.js';
import { videoTimeline, phaseById } from '../web/timeline.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function checkTimeWidth(page) {
  const viewport = page.viewportSize();
  try {
    for (const width of [1440, 640]) {
      await page.setViewportSize({ ...viewport, width });
      let original;
      for (const frame of [0, 249, 250, 499, 500, 749]) {
        const dimensions = await page.evaluate(frame => {
          const scrubber = document.getElementById('scrubber'), time = document.getElementById('time');
          scrubber.value = String(frame); scrubber.dispatchEvent(new Event('input'));
          const range = scrubber.getBoundingClientRect(), label = time.getBoundingClientRect();
          return { rangeX: range.x, rangeWidth: range.width, labelX: label.x, labelWidth: label.width,
            textFits: time.scrollWidth <= time.clientWidth };
        }, frame);
        original ??= dimensions;
        assert.deepEqual(dimensions, original, `${width}px: transport geometry changed at frame ${frame}`);
        assert.ok(dimensions.textFits, 'The complete time label must fit its reserved width.');
      }
    }
  } finally { await page.setViewportSize(viewport); }
}

export async function checkDurationUI(page, snapshot) {
  const wait = duration => page.waitForFunction(d => !document.getElementById('export').disabled &&
    document.querySelector('#preview-mount iframe')?.contentWindow.layout?.timeline.duration === d, duration, { timeout: 60000 });
  const scrub = frame => page.locator('#scrubber').evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input'));
  }, frame);
  assert.equal(await page.locator('#duration').inputValue(), '15');
  await page.locator('#duration').fill('10'); await wait(10); await scrub(100);
  for (let duration = 10; duration <= 30; duration++) {
    await page.locator('#duration').fill(String(duration)); await wait(duration);
    assert.equal(await page.locator('#scrubber').inputValue(), String(duration * 10));
    assert.equal(await page.locator('#scrubber').getAttribute('max'), String(duration * 25 - 1));
    assert.match(await page.locator('#export-spec').textContent(), new RegExp(`^${duration} seconds`));
    assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('[data-phase="domain"]').getAttribute('data-frame'), String(phaseById(videoTimeline(duration), 'domain').firstFrame));
  }
  await checkTimeWidth(page); await scrub(300);
  const preview = page.frames().find(frame => frame.url().includes('/web/index.html'));
  const renderer = await openRenderer({ theme: 'astral', animation: 'laseretch-campaign', language: 'en', tld: '.ORG', duration: 30, width: 900, height: 240 }, snapshot);
  try {
    for (const index of [70, 238, 300, 749]) {
      assert.equal(digest(Buffer.from(await preview.evaluate(i => window.renderFrame(i), index), 'base64')), digest(await renderer.frame(index)));
    }
  } finally { await renderer.close(); }
  await page.locator('#play').click();
  await page.locator('#duration').fill('10'); await wait(10);
  assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'true');
  assert.ok(Number(await page.locator('#scrubber').inputValue()) >= 100);
  await page.locator('#play').click();
  await scrub(249);
  await page.locator('#duration').fill('10.5');
  await page.waitForFunction(() => document.getElementById('error').textContent.includes('whole number'));
  assert.ok(await page.locator('#export').isDisabled());
  await page.locator('#duration').fill('20'); await page.locator('#duration').fill('30'); await wait(30);
  assert.equal(await page.locator('#scrubber').inputValue(), '749');
  assert.equal(await page.locator('#time').textContent(), '30.00 / 30.00 s');
  await page.locator('[data-phase="domain"]').click();
  assert.equal(await page.locator('#scrubber').inputValue(), '300');
  await page.locator('#duration').fill('15'); await wait(15); await scrub(295);
}
