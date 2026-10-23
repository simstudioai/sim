import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { CONTEXT_WINDOW_MODELS } from '@/app/(landing)/models/context-windows'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

export default async function Image() {
  return createCoverOgImage({
    title: 'LLM Context Window Comparison',
    subtitle: `Context windows, max output tokens, and API prices for ${CONTEXT_WINDOW_MODELS.length} models, from largest to smallest.`,
  })
}
