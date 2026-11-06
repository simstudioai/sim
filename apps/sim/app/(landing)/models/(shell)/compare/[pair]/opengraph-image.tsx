import { notFound } from 'next/navigation'
import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import {
  buildComparisonVerdict,
  getModelComparisonBySlug,
  MODEL_COMPARISONS,
} from '@/app/(landing)/models/comparisons'

export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/** Pre-render catalog images separately from their sibling pages. */
export async function generateStaticParams() {
  return MODEL_COMPARISONS.map((comparison) => ({ pair: comparison.slug }))
}

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params
  const comparison = getModelComparisonBySlug(pair)

  if (!comparison) {
    notFound()
  }

  return createCoverOgImage({
    title: comparison.title,
    subtitle: buildComparisonVerdict(comparison)[0],
  })
}
