import { attachment, smootherstep } from './layout.js';

export const INTRO_MOVE_START = 4.5, INTRO_MOVE_END = 5;
export function introProgress(time) {
  return smootherstep(Math.max(0, Math.min(1, (time - INTRO_MOVE_START) / (INTRO_MOVE_END - INTRO_MOVE_START))));
}
export function introFrame(index, last = 125) {
  return Math.min(last, Math.round(index * INTRO_MOVE_END / INTRO_MOVE_START));
}
export function finalPose(layout) {
  return { x: attachment(layout, 0).x, y: layout.top, width: layout.baseWidth, height: layout.logoHeight, scale: layout.logoScale };
}
export function largePose(layout) {
  const fit = Math.min((layout.width - 2 * layout.padding) / layout.baseWidth,
    (layout.height - 2 * Math.min(layout.padding, layout.height * .05)) / layout.logoHeight);
  const width = layout.baseWidth * fit, height = layout.logoHeight * fit;
  return { x: Math.round((layout.width - width) / 2), y: Math.round((layout.height - height) / 2), width, height, scale: layout.logoScale * fit };
}
export function introPose(layout, time) {
  const small = finalPose(layout), large = largePose(layout), p = introProgress(time);
  if (p === 1) return small;
  const mix = key => large[key] + (small[key] - large[key]) * p;
  return { x: Math.round(mix('x')), y: Math.round(mix('y')), width: mix('width'), height: mix('height'), scale: mix('scale') };
}
export function introMetadata(layout) {
  return { version: 1, large: largePose(layout), final: finalPose(layout), effectTimeScale: INTRO_MOVE_END / INTRO_MOVE_START,
    moveStart: INTRO_MOVE_START, moveEnd: INTRO_MOVE_END, easing: 'quintic smootherstep',
    fit: 'Uniform wordmark scaling with piecewise canvas-margin fitting', finalColorTiming: 'During movement only' };
}

// Keep the canvas edges fixed while moving the wordmark's own coordinates.
// Overscan is extrapolated, not cropped into a larger copy of the whole frame.
function axis(extent, start, span, targetStart, targetSpan) {
  const ratio = targetSpan / span, end = start + span;
  const before = start > 0 ? targetStart / start : ratio;
  const after = extent > end ? (extent - targetStart - targetSpan) / (extent - end) : ratio;
  return value => {
    if (value < start) return targetStart + (value - start) * before;
    if (value > end) return targetStart + targetSpan + (value - end) * after;
    return targetStart + (value - start) * ratio;
  };
}
export function introMapping(layout, pose) {
  const small = finalPose(layout);
  return { x: axis(layout.width, small.x, small.width, pose.x, pose.width),
    y: axis(layout.height, small.y, small.height, pose.y, pose.height),
    columns: [small.x, small.x + small.width], rows: [small.y, small.y + small.height] };
}
export function mappedBox(mapping, left, top, width, height) {
  const x0 = mapping.x(left), y0 = mapping.y(top), x1 = mapping.x(left + width), y1 = mapping.y(top + height);
  const x = Math.round(x0), y = Math.round(y0);
  return { left: x0, top: y0, cellW: x1 - x0, cellH: y1 - y0, x, y, width: Math.round(x1) - x, height: Math.round(y1) - y };
}
function intervals(start, size, boundaries) {
  return [start, ...boundaries.filter(value => value > start && value < start + size), start + size];
}
// Native glyph rasters may cross a mapping boundary. Split there rather than
// stretching their surrounding margins along with the wordmark.
export function drawMappedImage(ctx, image, source, destination, mapping) {
  const xs = intervals(destination.x, destination.width, mapping.columns);
  const ys = intervals(destination.y, destination.height, mapping.rows);
  for (let row = 1; row < ys.length; row++) for (let col = 1; col < xs.length; col++) {
    const left = xs[col - 1], top = ys[row - 1], width = xs[col] - left, height = ys[row] - top;
    const sx = source.x + (left - destination.x) / destination.width * source.width;
    const sy = source.y + (top - destination.y) / destination.height * source.height;
    ctx.drawImage(image, sx, sy, width / destination.width * source.width, height / destination.height * source.height,
      mapping.x(left), mapping.y(top), mapping.x(left + width) - mapping.x(left), mapping.y(top + height) - mapping.y(top));
  }
}
