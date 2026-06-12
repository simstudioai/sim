import {
  formatTokenCount,
  MAX_CONTEXT_WINDOW,
  TOTAL_MODEL_PROVIDERS,
  TOTAL_MODELS,
} from '@/app/(landing)/models/utils'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

export default async function Image() {
  return createLandingOgImage({
    eyebrow: 'Sim model directory',
    title: 'AI Models Directory',
    subtitle:
      'Browse tracked AI models with pricing, context windows, and workflow-ready capability details.',
    pills: [
      `${TOTAL_MODELS} models`,
      `${TOTAL_MODEL_PROVIDERS} providers`,
      `${formatTokenCount(MAX_CONTEXT_WINDOW)} max context`,
    ],
    domainLabel: 'sim.ai/models',
  })
}
