import { notFound } from 'next/navigation'
import { createModelsOgImage } from '@/app/(landing)/models/og-utils'
import {
  formatPrice,
  formatTokenCount,
  getModelBySlug,
  getProviderBySlug,
} from '@/app/(landing)/models/utils'

export const runtime = 'edge'
export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
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

  return createModelsOgImage({
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
