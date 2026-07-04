import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'

/** Shared OpenGraph/Twitter card image for landing pages. */
const OG_IMAGE_URL = '/logo/426-240/reverse/small.png'
const OG_IMAGE_WIDTH = 2130
const OG_IMAGE_HEIGHT = 1200

interface LandingMetadataInput {
  /** Absolute `<title>`, rendered as-is (no site template applied). */
  title: string
  description: string
  /** Path under the site root, e.g. `/pricing`. Use `''` for the home page. */
  path: string
  /** Optional comma-separated keywords; omitted from the output when absent. */
  keywords?: string
  /** OpenGraph image alt text. Defaults to {@link title}. */
  imageAlt?: string
  /** Twitter card image alt text. Defaults to {@link imageAlt}. */
  twitterImageAlt?: string
}

/**
 * Builds the canonical metadata for a static landing page — the single source of
 * truth for the OpenGraph/Twitter/robots/canonical chrome shared across the
 * landing family, so per-page files declare only what actually varies (title,
 * description, keywords, path, and any non-default image alt).
 *
 * Note: dynamic and image-bearing routes that resolve their card from a sibling
 * `opengraph-image` (integrations, models) and the blog family (`buildPostMetadata`
 * in `lib/blog/seo`) intentionally do not use this helper.
 */
export function buildLandingMetadata({
  title,
  description,
  path,
  keywords,
  imageAlt,
  twitterImageAlt,
}: LandingMetadataInput): Metadata {
  const url = `${SITE_URL}${path}`
  const ogAlt = imageAlt ?? title
  const twitterAlt = twitterImageAlt ?? ogAlt

  return {
    metadataBase: new URL(SITE_URL),
    title: { absolute: title },
    description,
    ...(keywords ? { keywords } : {}),
    authors: [{ name: 'Sim' }],
    creator: 'Sim',
    publisher: 'Sim',
    openGraph: {
      title,
      description,
      type: 'website',
      url,
      siteName: 'Sim',
      locale: 'en_US',
      images: [
        {
          url: OG_IMAGE_URL,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          alt: ogAlt,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@simdotai',
      creator: '@simdotai',
      title,
      description,
      images: { url: OG_IMAGE_URL, alt: twitterAlt },
    },
    alternates: {
      canonical: url,
      languages: { 'en-US': url, 'x-default': url },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
    category: 'technology',
  }
}

/**
 * Google's documented pattern for faceted/filtered navigation: keep the single
 * unfiltered listing indexable and `noindex` (but still `follow`) any
 * filtered or paginated variant, so link equity flows through without asking
 * Google to index every query-param permutation. Used by every catalog page
 * that serves distinct content per query param (integrations, models, blog,
 * careers, pricing) — `metadata.alternates.canonical` on all of them still
 * points at the bare URL regardless of `isFiltered`.
 */
export function withFilteredNoindex(metadata: Metadata, isFiltered: boolean): Metadata {
  return { ...metadata, ...(isFiltered && { robots: { index: false, follow: true } }) }
}
