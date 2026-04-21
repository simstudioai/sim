import { notFound } from 'next/navigation'
import { createModelsOgImage } from '@/app/(landing)/models/og-utils'
import {
  formatPrice,
  formatTokenCount,
  getCheapestProviderModel,
  getLargestContextProviderModel,
  getProviderBySlug,
} from '@/app/(landing)/models/utils'

export const runtime = 'edge'
export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

export default async function Image({ params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerSlug } = await params
  const provider = getProviderBySlug(providerSlug)

  if (!provider || provider.models.length === 0) {
    notFound()
  }

  const cheapestModel = getCheapestProviderModel(provider)
  const largestContextModel = getLargestContextProviderModel(provider)

  return createModelsOgImage({
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
