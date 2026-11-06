import { notFound } from 'next/navigation'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { ALL_COMPETITORS, getCompetitorBySlug } from '@/app/(landing)/comparisons/utils'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Pre-render every comparison card alongside its page. */
export async function generateStaticParams() {
  return ALL_COMPETITORS.map((competitor) => ({ provider: competitor.id }))
}

export default async function Image({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const competitor = getCompetitorBySlug(provider)

  if (!competitor) {
    notFound()
  }

  return createCoverOgImage({
    title: `Sim vs ${competitor.name}`,
    subtitle: 'Platform, AI, integrations, pricing, security, and support, with sourced facts',
  })
}
