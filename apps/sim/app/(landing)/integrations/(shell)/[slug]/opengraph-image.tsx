import { notFound } from 'next/navigation'
import integrationsJson from '@/lib/integrations/integrations.json'
import type { AuthType, Integration } from '@/lib/integrations/types'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

/** Raw catalog JSON, not the barrel - keeps `@/blocks/registry` out of the OG bundle. */
const integrations = integrationsJson.integrations as readonly Integration[]
const bySlug = new Map(integrations.map((i) => [i.slug, i]))

const AUTH_LABEL: Record<AuthType, string> = {
  oauth: 'One-click OAuth',
  'api-key': 'API key auth',
  none: 'No auth required',
}

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

  const pills = [
    integration.operationCount > 0
      ? `${integration.operationCount} tool${integration.operationCount === 1 ? '' : 's'}`
      : null,
    integration.triggerCount > 0
      ? `${integration.triggerCount} real-time trigger${integration.triggerCount === 1 ? '' : 's'}`
      : null,
    AUTH_LABEL[integration.authType],
    'Free to start',
  ].filter((pill): pill is string => pill !== null)

  return createLandingOgImage({
    eyebrow: 'Sim integration',
    title: `${integration.name} Integration`,
    subtitle: integration.description,
    pills,
    domainLabel: `sim.ai/integrations/${slug}`,
  })
}
