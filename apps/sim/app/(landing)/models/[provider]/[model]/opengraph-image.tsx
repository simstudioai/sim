import { notFound } from 'next/navigation'
import { contentType, createModelsOgImage, runtime, size } from '../../og-utils'
import { formatPrice, formatTokenCount, getModelBySlug, getProviderBySlug } from '../../utils'

export { contentType, runtime, size }

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
