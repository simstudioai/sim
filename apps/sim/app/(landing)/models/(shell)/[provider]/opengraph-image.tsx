import { notFound } from 'next/navigation'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { getProviderBySlug, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Pre-render catalog images separately from their sibling pages. */
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

  return createCoverOgImage({
    title: `${provider.name} models`,
    subtitle: `Browse ${provider.modelCount} tracked ${provider.name} models with pricing, context windows, default model selection, and capability coverage.`,
  })
}
