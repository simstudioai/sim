import { notFound } from 'next/navigation'
import {
  formatPrice,
  formatTokenCount,
  getCheapestProviderModel,
  getLargestContextProviderModel,
  getProviderBySlug,
  MODEL_PROVIDERS_WITH_CATALOGS,
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
 * routes, so without this export every provider's OG image 404s.
 */
export async function generateStaticParams() {
  return MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
    provider: provider.slug,
  }))
}

export default async function Image({ params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerSlug } = await params
  const provider = getProviderBySlug(providerSlug)

  if (!provider || provider.models.length === 0) {
    notFound()
  }

  const cheapestModel = getCheapestProviderModel(provider)
  const largestContextModel = getLargestContextProviderModel(provider)

  return createLandingOgImage({
    eyebrow: `${provider.name} on Sim`,
    title: `${provider.name} models`,
    subtitle: `Browse ${provider.modelCount} tracked ${provider.name} models with pricing, context windows, default model selection, and model capability coverage.`,
    pills: [
      `${provider.modelCount} tracked`,
      provider.defaultModelDisplayName || 'Dynamic default',
      cheapestModel ? `From ${formatPrice(cheapestModel.pricing.input)}/1M` : 'Pricing tracked',
      largestContextModel?.contextWindow
        ? `${formatTokenCount(largestContextModel.contextWindow)} context`
        : 'Context tracked',
    ],
    domainLabel: `sim.ai${provider.href}`,
  })
}
