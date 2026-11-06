import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { TOOL_MODELS } from '@/app/(landing)/models/tools'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

export default async function Image() {
  return createCoverOgImage({
    title: 'LLM API Pricing Calculator',
    subtitle: `Estimate cost per request and per month across ${TOOL_MODELS.length} models from OpenAI, Anthropic, Google, and more.`,
  })
}
