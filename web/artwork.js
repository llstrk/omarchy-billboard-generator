function rasterize(rectangles, theme, scale, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, height * scale);
  for (const band of theme.gradient) {
    gradient.addColorStop(band.from / 100, band.color); gradient.addColorStop(band.to / 100, band.color);
  }
  ctx.fillStyle = gradient;
  // Rasterize official geometry at each pose, never enlarge a resting raster.
  for (const r of rectangles) {
    const x = Math.round(r.x * scale), y = Math.round(r.y * scale);
    ctx.fillRect(x, y, Math.round((r.x + r.width) * scale) - x, Math.round((r.y + r.height) * scale) - y);
  }
  return canvas;
}
export function createArtwork(config, layout) {
  const { theme, wordmark } = config;
  const makeBase = scale => rasterize(wordmark.base, theme, scale, wordmark.baseWidth, wordmark.height);
  const base = makeBase(layout.logoScale);
  const suffix = rasterize(wordmark.suffix, theme, layout.logoScale, wordmark.fullWidth, wordmark.height);
  let cachedScale, cachedBase;
  return { base, suffix, atPose(pose) {
    if (pose.scale === layout.logoScale) return base;
    // One moving raster is retained, independent of frame count or seek order.
    if (pose.scale !== cachedScale) { cachedBase = makeBase(pose.scale); cachedScale = pose.scale; }
    return cachedBase;
  } };
}
