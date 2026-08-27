import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { TOTAL_MODEL_PROVIDERS, TOTAL_MODELS } from '@/app/(landing)/models/utils'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

export default async function Image() {
  return createCoverOgImage({
    title: 'AI Models Directory',
    subtitle: `Browse ${TOTAL_MODELS} models from ${TOTAL_MODEL_PROVIDERS} providers with pricing, context windows, and workflow-ready capability details.`,
  })
}
