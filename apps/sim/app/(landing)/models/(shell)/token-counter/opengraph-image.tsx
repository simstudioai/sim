import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

export default async function Image() {
  return createCoverOgImage({
    title: 'Token Counter',
    subtitle:
      'Count tokens and estimate input cost for OpenAI, Claude, Gemini, and other models, right in your browser.',
  })
}
