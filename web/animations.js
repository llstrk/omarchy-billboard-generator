export async function createAnimation(config, layout, artwork, ctx) {
  if (config.animation.origin === 'campaign') {
    const { createCampaignAnimation } = await import('./campaign-animation.js');
    return createCampaignAnimation(config, layout, artwork, ctx);
  }
  const { createWebsiteAnimation } = await import('./website-animation.js');
  return createWebsiteAnimation(config, layout, artwork, ctx);
}
