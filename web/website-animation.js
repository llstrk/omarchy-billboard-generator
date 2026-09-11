import { websiteSimulation } from './website-simulation.js';
import { drawCell, themeInk } from './etch-cells.js';
import { introFrame, introPose, introProgress, introMapping, mappedBox } from './intro.js';

function cellBox(index, frame, offset, layout, mapping) {
  const cellW = 5.1 * layout.logoScale, cellH = 5 * layout.logoScale;
  const left = Math.round((layout.width - layout.baseWidth) / 2) + (index % frame.width - offset.x) * cellW;
  const top = layout.top + (Math.floor(index / frame.width) - offset.y) * cellH;
  return mappedBox(mapping, left, top, cellW, cellH);
}
function visible(symbol, flag) { return symbol !== 0 && symbol !== 32 && !(flag & 32); }
function drawFrame(ctx, frame, offset, layout, mapping, ink) {
  for (let i = 0; i < frame.symbols.length; i++) {
    if (!visible(frame.symbols[i], frame.flags[i])) continue;
    const box = cellBox(i, frame, offset, layout, mapping);
    if (box.width <= 0 || box.height <= 0) continue;
    ctx.fillStyle = ink(frame.fg[i] & 0xffffff);
    drawCell(ctx, frame.symbols[i], box);
  }
}
function paletteSettle(config, artwork) {
  let layer, context;
  return (ctx, pose, progress) => {
    if (progress <= 0) return;
    if (!layer) {
      layer = document.createElement('canvas'); layer.width = config.width; layer.height = config.height;
      context = layer.getContext('2d');
    }
    // Crossfade complete opaque scenes so bitmap-edge differences fade away
    // without a dark midpoint or residual cells at the final-geometry handoff.
    context.fillStyle = config.theme.background; context.fillRect(0, 0, layer.width, layer.height);
    context.drawImage(artwork.atPose(pose), pose.x, pose.y);
    ctx.save(); ctx.globalAlpha = progress; ctx.drawImage(layer, 0, 0); ctx.restore();
  };
}
export async function createWebsiteAnimation(config, layout, artwork, ctx) {
  const simulation = await websiteSimulation(config.animation, config.theme, layout), ink = themeInk(config.theme);
  const settle = paletteSettle(config, artwork);
  return {
    metadata: { seeds: [42], simulationFps: config.animation.stepsPerSecond, totalSteps: simulation.totalSteps,
      animationProvenance: config.animation.provenance, animationViewport: simulation.viewport, nativeEffectColors: false,
      effectTreatment: 'Website bitmap cells and nearest-brightness theme inks', animationDuration: 5, settleMs: 500 },
    draw(index, x) {
      if (index >= 125) { ctx.drawImage(artwork.base, x, layout.top); return; }
      const time = index / 25, pose = introPose(layout, time), mapping = introMapping(layout, pose);
      drawFrame(ctx, simulation.frames[introFrame(index, 119)], simulation.offset, layout, mapping, ink);
      settle(ctx, pose, introProgress(time));
    },
  };
}
