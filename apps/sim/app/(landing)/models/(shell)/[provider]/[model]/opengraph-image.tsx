import { notFound } from 'next/navigation'
import {
  ALL_CATALOG_MODELS,
  formatPrice,
  formatTokenCount,
  getModelBySlug,
  getProviderBySlug,
} from '@/app/(landing)/models/utils'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

/**
 * The sibling page.tsx sets `dynamicParams = false`, a segment-level
 * restriction that also blocks this metadata route from rendering any
 * param combination it wasn't statically generated for - but Next does not
 * share generateStaticParams between a page and its sibling metadata
 * routes, so without this export every model's OG image 404s.
 */
export async function generateStaticParams() {
  return ALL_CATALOG_MODELS.map((model) => ({
    provider: model.providerSlug,
    model: model.slug,
  }))
}

export default async function Image({
  params,
}: {
  params: Promise<{ provider: string; model: string }>
}) {
  const { provider: providerSlug, model: modelSlug } = await params
  const provider = getProviderBySlug(providerSlug)
  const model = getModelBySlug(providerSlug, modelSlug)

  if (!provider || !model) {
    notFound()
  }

  return createLandingOgImage({
    eyebrow: `${provider.name} model`,
    title: model.displayName,
    subtitle: `${provider.name} pricing, context window, and feature support generated from Sim's model registry.`,
    pills: [
      `Input ${formatPrice(model.pricing.input)}/1M`,
      `Output ${formatPrice(model.pricing.output)}/1M`,
      model.contextWindow ? `${formatTokenCount(model.contextWindow)} context` : 'Unknown context',
      model.capabilityTags[0] ?? 'Capabilities tracked',
    ],
    domainLabel: `sim.ai${model.href}`,
  })
}
