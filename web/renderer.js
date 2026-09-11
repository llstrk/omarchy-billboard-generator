import { createAnimation } from './animations.js';
import { calculateLayout, attachment, cursorVerticalBox } from './layout.js';
import { backgroundWarnings } from './contrast.js';
import { createArtwork } from './artwork.js';
import { introMetadata } from './intro.js';
import { referenceTime, phaseById } from './timeline.js';

async function loadConfiguration() {
  const preview = new URLSearchParams(location.search).get('preview');
  if (preview) document.documentElement.classList.add('app-preview');
  const response = await fetch(preview ? `/api/previews/${encodeURIComponent(preview)}/config` : '/config.json');
  if (!response.ok) throw Error('Cannot load render configuration.');
  return response.json();
}
function outputCanvas(width, height) {
  const canvas = document.querySelector('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width !== width || canvas.height !== height) throw Error(`Browser could not allocate a ${width}x${height} canvas. Try dimensions within your browser and memory limits.`);
  return { canvas, ctx };
}
async function loadFonts(config) {
  const { family, file } = config.font;
  if (family !== 'JetBrains Mono') {
    const face = new FontFace(family, `url('/assets/fonts/${file}')`, { weight: '100 900' });
    document.fonts.add(await face.load());
  }
  for (const spec of ['400 17px "JetBrains Mono"', '700 17px "JetBrains Mono"', `700 34px "${family}"`]) {
    const faces = await document.fonts.load(spec, config.locale.tagline);
    if (!faces.length) throw Error(`Required font did not load: ${spec}`);
  }
  await document.fonts.ready;
}
function validateIndex(index, timeline) {
  if (!Number.isInteger(index) || index < 0 || index >= timeline.frameCount) throw Error(`Frame index must be between 0 and ${timeline.lastFrame}.`);
}
const cursorVisible = (p, elapsed) => p < 1 || ((elapsed % 1 + 1) % 1) < .5;

async function initialize() {
  const config = await loadConfiguration(), { width, height, theme, locale } = config;
  const { canvas, ctx } = outputCanvas(width, height);
  await loadFonts(config);
  const layout = calculateLayout(ctx, config);
  layout.warnings.push(...backgroundWarnings(config));
  const artwork = createArtwork(config, layout), { suffix } = artwork;
  const animation = await createAnimation(config, layout, artwork, ctx);
  const typing = phaseById(config.timeline, 'tagline'), typingEndFrame = typing.startFrame + typing.duration * 25;
  const segmenter = new Intl.Segmenter(locale.id, { granularity: 'grapheme' });
  const lines = layout.lines.map(line => ({ ...line, clusters: [...segmenter.segment(line.text)].map(s => s.segment) }));
  const clusterCount = lines.reduce((n, line) => n + line.clusters.length, 0);
  function drawCursor(line, shown, start) {
    const advance = ctx.measureText(shown).width;
    const cursorX = locale.direction === 'rtl' ? start - advance - layout.cursorGap - layout.cursorWidth : start + advance + layout.cursorGap;
    const { top, height } = cursorVerticalBox(layout, line);
    ctx.save(); ctx.fillStyle = theme.cursor ?? theme.brand;
    ctx.fillRect(Math.round(cursorX), top, layout.cursorWidth, height);
    ctx.restore();
  }
  function drawTypedLine(line, count, active, p, time) {
    const shown = line.clusters.slice(0, count).join('');
    const start = (width + (locale.direction === 'rtl' ? line.width : -line.width)) / 2;
    ctx.fillText(shown, start, line.y);
    if (active && cursorVisible(p, time)) drawCursor(line, shown, start);
  }
  function drawTagline(time, cursorElapsed) {
    if (time < 5) return;
    const p = Math.min(1, (time - 5) / 2); let remaining = Math.floor(p * clusterCount);
    ctx.font = layout.font; ctx.textBaseline = 'alphabetic'; ctx.direction = locale.direction;
    ctx.textAlign = locale.direction === 'rtl' ? 'right' : 'left'; ctx.fillStyle = theme.brand;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], count = Math.min(remaining, line.clusters.length);
      const active = remaining <= line.clusters.length || i === lines.length - 1;
      drawTypedLine(line, count, active, p, cursorElapsed);
      remaining -= count;
      if (active) break;
    }
  }
  function drawSuffix(x, reveal) {
    if (reveal <= 0) return;
    ctx.save(); ctx.beginPath(); ctx.rect(Math.round(x + layout.baseWidth), layout.top, reveal + 1, Math.ceil(layout.logoHeight)); ctx.clip();
    ctx.drawImage(suffix, x, layout.top); ctx.restore();
  }
  window.layout = { ...layout, settings: { tld: config.tld, theme: theme.id, animation: config.animation.id, background: config.background ?? 'theme', backgroundColor: theme.background, themeOrigin: theme.origin, themeProvenance: theme.provenance, language: locale.id, revision: config.commit },
    tagline: locale.tagline, direction: locale.direction, timeline: config.timeline, intro: introMetadata(layout, config.timeline), ...animation.metadata,
  };
  window.renderFrame = (index, encode = true) => {
    validateIndex(index, config.timeline);
    const time = referenceTime(config.timeline, index), { x, reveal } = attachment(layout, time);
    ctx.globalAlpha = 1; ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
    animation.draw(index, x);
    drawTagline(time, (index - typingEndFrame) / 25); drawSuffix(x, reveal);
    return encode ? canvas.toDataURL('image/png').split(',')[1] : null;
  };
  window.ready = true;
}
initialize().catch(error => { window.renderError = error.stack || String(error); });
