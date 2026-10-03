import { notFound } from 'next/navigation'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import {
  ALL_CATALOG_MODELS,
  formatPrice,
  formatTokenCount,
  getModelBySlug,
  getProviderBySlug,
} from '@/app/(landing)/models/utils'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Pre-render catalog images separately from their sibling pages. */
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

  return createCoverOgImage({
    title: model.displayName,
    subtitle: `${provider.name} · ${formatPrice(model.pricing.input)}/1M in, ${formatPrice(model.pricing.output)}/1M out, ${formatTokenCount(model.contextWindow)} context — from Sim's model registry.`,
  })
}
