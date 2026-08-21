import integrationsJson from '@sim/deployment-config/integrations.json'
import { notFound } from 'next/navigation'
import type { Integration } from '@/lib/integrations/types'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Raw catalog JSON, not the barrel - keeps `@/blocks/registry` out of the OG bundle. */
const integrations = integrationsJson.integrations as readonly Integration[]
const bySlug = new Map(integrations.map((i) => [i.slug, i]))

/**
 * The sibling page.tsx sets `dynamicParams = false`, a segment-level
 * restriction that also blocks this metadata route from rendering any
 * param combination it wasn't statically generated for - but Next does not
 * share generateStaticParams between a page and its sibling metadata
 * routes, so without this export every integration's OG image 404s.
 */
export async function generateStaticParams() {
  return integrations.map((integration) => ({ slug: integration.slug }))
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const integration = bySlug.get(slug)

  if (!integration) {
    notFound()
  }

  return createCoverOgImage({
    title: `${integration.name} Integration`,
    subtitle: integration.description,
  })
}
