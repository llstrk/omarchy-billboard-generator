import { paintFrame } from '../assets/runtime/assets/playback.js';
import { createIndependentSparks, withoutFloor } from './independent-sparks.js';
import { createSimulation } from './simulation.js';
import { attachment, effectMapping } from './layout.js';
import { introFrame, introPose, introMapping, mappedBox, drawMappedImage } from './intro.js';
import { referenceFrame } from './timeline.js';

function removeBlackBackground(nativeCtx, native) {
  const pixels = nativeCtx.getImageData(0, 0, native.width, native.height);
  for (let p = 0; p < pixels.data.length; p += 4) {
    if (pixels.data[p] === 0 && pixels.data[p + 1] === 0 && pixels.data[p + 2] === 0) pixels.data[p + 3] = 0;
  }
  nativeCtx.putImageData(pixels, 0, 0);
}
export async function createCampaignAnimation(config, layout, artwork, ctx) {
  const { width, height, theme } = config, { cellW, cellH } = layout;
  const sim = await createSimulation(fetch, config.timeline), { columns, rows, padX, padTop, final, targets } = sim;
  const effectX = attachment(layout, 0).x - padX * cellW;
  const { originY: effectY, splitRow, mapY } = effectMapping(layout, padTop, rows);
  const sparks = createIndependentSparks(sim.primary.frames, sim.secondary.frames, columns, rows, cellW, cellH, effectX, effectY,
    { width, height, scale: layout.logoHeight / 144, mapY, floorY: layout.floorY });
  const native = document.createElement('canvas'); native.width = columns * 10; native.height = rows * 20;
  const nativeCtx = native.getContext('2d', { willReadFrequently: true });
  const nativeLayout = { cellWidth: 10, cellHeight: 20, fontSize: 17, cssWidth: native.width, cssHeight: native.height };
  const airborne = document.createElement('canvas'); airborne.width = width; airborne.height = height;
  const airborneCtx = airborne.getContext('2d'), screen = { x: 0, y: 0, width, height };
  function effectShadow(context) {
    if (theme.light) { context.shadowColor = '#000000'; context.shadowBlur = Math.max(2, layout.unit * 2); }
  }
  function settled(f, i) {
    return targets[i] !== 32 && f.symbols[i] === final.symbols[i] && f.fg[i] === final.fg[i] && f.bg[i] === final.bg[i] && !(f.flags[i] & 32);
  }
  function replaceSettledCells(f, pose, mapping) {
    const base = artwork.atPose(pose);
    for (let i = 0; i < targets.length; i++) {
      if (!settled(f, i)) continue;
      const col = i % columns, row = Math.floor(i / columns);
      const box = mappedBox(mapping, effectX + col * cellW, effectY + row * cellH, cellW, cellH);
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip(); ctx.fillStyle = theme.background;
      ctx.fillRect(box.x, box.y, box.width, box.height); ctx.drawImage(base, pose.x, pose.y); ctx.restore();
    }
  }
  function drawLaser(f, pose, mapping) {
    // Preserve native effect colors; only pure black is transparent.
    paintFrame(nativeCtx, nativeLayout, f.symbols, f.fg, f.bg, f.flags, columns, rows, true);
    removeBlackBackground(nativeCtx, native);
    ctx.save(); effectShadow(ctx); ctx.imageSmoothingEnabled = false;
    drawMappedImage(ctx, native, { x: 0, y: 0, width: native.width, height: splitRow * 20 },
      { x: effectX, y: effectY, width: columns * cellW, height: splitRow * cellH }, mapping);
    // Apply the existing floor placement before fitting the intro margins.
    for (let row = splitRow; row < rows; row++) {
      drawMappedImage(ctx, native, { x: 0, y: row * 20, width: native.width, height: 20 },
        { x: effectX, y: mapY(row), width: columns * cellW, height: cellH }, mapping);
    }
    ctx.restore(); replaceSettledCells(f, pose, mapping);
  }
  function drawIntro(index, clock) {
    const pose = introPose(layout, clock / 25), mapping = introMapping(layout, pose);
    const frame = sim.playback ? withoutFloor(sim.playback.primary[index], columns, rows) : sparks.withoutPrimaryFloor(introFrame(clock));
    drawLaser(frame, pose, mapping);
    // Airborne sparks follow the moving field, but retain their native clock.
    airborneCtx.clearRect(0, 0, width, height); airborneCtx.imageSmoothingEnabled = false;
    sparks.drawAirborne(airborneCtx, Math.floor(clock), sim.playback?.secondary[index]);
    ctx.save(); effectShadow(ctx); ctx.imageSmoothingEnabled = false;
    drawMappedImage(ctx, airborne, screen, screen, mapping); ctx.restore();
  }
  return {
    metadata: { seeds: [42, 137], simulationFps: 240, padX, padTop, totalSteps: sim.primary.totalSteps, sparkMetadata: sparks.metadata,
      animationSamples: sim.playback?.primary.length ?? sim.primary.frames.length,
      nativeEffectColors: true, fixedGroundLayer: true, nativeLaserTailClock: true, lightEffectTreatment: theme.light ? 'Original colors with dark shadow for contrast' : 'Original colors' },
    draw(index, x) {
      const clock = referenceFrame(config.timeline, index);
      if (clock >= 125) ctx.drawImage(artwork.base, x, layout.top); else drawIntro(index, clock);
      ctx.save(); effectShadow(ctx); ctx.imageSmoothingEnabled = false; sparks.drawGround(ctx, Math.floor(clock)); ctx.restore();
    },
  };
}
