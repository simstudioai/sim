/**
 * @vitest-environment node
 */
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { ContentMeta } from '@/lib/content/schema'
import {
  buildArticleJsonLd,
  buildCollectionPageJsonLd,
  buildIndexMetadata,
  buildPostMetadata,
} from '@/lib/content/seo'
import { buildLandingMetadata, LANDING_SOCIAL_IMAGE } from '@/lib/landing/seo'
import teamAuthor from '@/content/authors/sim.json'

vi.mock('@/lib/core/utils/urls', () => ({ SITE_URL: 'https://example.com' }))

const SECTIONS = [
  { name: 'Blog', basePath: '/blog', description: 'Latest posts' },
  { name: 'Library', basePath: '/library', description: 'Guides and comparisons' },
  { name: 'Customers', basePath: '/customers', description: 'Customer stories' },
]

const POST: ContentMeta = {
  slug: 'example',
  title: 'Example article',
  description: 'An article with its own cover image.',
  date: '2026-01-01T00:00:00.000Z',
  author: teamAuthor,
  authors: [teamAuthor],
  tags: ['guides'],
  ogImage: '/blog/example/cover.jpg',
  ogImageWidth: 1600,
  ogImageHeight: 900,
  canonical: 'https://example.com/blog/example',
  draft: false,
  featured: false,
  technical: true,
}

describe('content social images', () => {
  it.each(SECTIONS)('$name shares the landing image across Open Graph and Twitter', (section) => {
    const metadata = buildIndexMetadata(section, { pageNum: 1 })
    const landing = buildLandingMetadata({
      title: 'Home',
      description: 'The workspace',
      path: '',
    })

    expect(metadata.openGraph?.images).toEqual([
      {
        ...LANDING_SOCIAL_IMAGE,
        url: `https://example.com${LANDING_SOCIAL_IMAGE.url}`,
        alt: `Sim ${section.name}`,
      },
    ])
    expect(metadata.twitter?.images).toEqual({
      url: `https://example.com${LANDING_SOCIAL_IMAGE.url}`,
      alt: `Sim ${section.name}`,
    })
    expect(landing.openGraph?.images).toEqual([{ ...LANDING_SOCIAL_IMAGE, alt: 'Home' }])
    expect(metadata.alternates?.canonical).toBe(`https://example.com${section.basePath}`)
  })

  it('declares the actual dimensions and format of the shared image', async () => {
    const metadata = await sharp(path.join('public', LANDING_SOCIAL_IMAGE.url)).metadata()

    expect(metadata).toMatchObject({
      width: LANDING_SOCIAL_IMAGE.width,
      height: LANDING_SOCIAL_IMAGE.height,
      format: 'png',
    })
    expect(LANDING_SOCIAL_IMAGE.type).toBe('image/png')
  })

  it('preserves filtered titles, canonical URLs, and noindex policy', () => {
    const metadata = buildIndexMetadata(SECTIONS[0], { tag: 'guides', pageNum: 2 })

    expect(metadata.title).toBe('Blog | guides | Page 2')
    expect(metadata.alternates?.canonical).toBe('https://example.com/blog')
    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.openGraph?.images).toEqual(
      buildIndexMetadata(SECTIONS[0], { pageNum: 1 }).openGraph?.images
    )
  })

  it('retains article-specific artwork and dimensions', () => {
    const metadata = buildPostMetadata(POST)

    expect(metadata.openGraph?.images).toEqual([
      {
        url: `https://example.com${POST.ogImage}`,
        width: 1600,
        height: 900,
        alt: POST.title,
      },
    ])
    expect(metadata.twitter?.images).toEqual([POST.ogImage])
    expect(buildArticleJsonLd(POST).image[0].url).toBe(`https://example.com${POST.ogImage}`)
  })

  it('uses the current square logo for publishers and the team avatar', async () => {
    const article = buildArticleJsonLd(POST)
    const collection = buildCollectionPageJsonLd(SECTIONS[0], [POST])

    expect(teamAuthor.avatarUrl).toBe('/brandbook/logo/small.png')
    expect(article.publisher.logo.url).toBe(`https://example.com${teamAuthor.avatarUrl}`)
    expect(collection.publisher.logo.url).toBe(article.publisher.logo.url)
    expect(await sharp(path.join('public', teamAuthor.avatarUrl)).metadata()).toMatchObject({
      width: 1200,
      height: 1200,
      format: 'png',
    })
  })
})
