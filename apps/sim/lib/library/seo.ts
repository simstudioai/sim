import type { Metadata } from 'next'
import type { Author, ContentMeta } from '@/lib/content/schema'
import type { ContentSection } from '@/lib/content/seo'
import {
  buildArticleJsonLd,
  buildAuthorGraphJsonLd as buildAuthorGraphJsonLdGeneric,
  buildAuthorMetadata as buildAuthorMetadataGeneric,
  buildCollectionPageJsonLd as buildCollectionPageJsonLdGeneric,
  buildFaqJsonLd,
  buildIndexMetadata as buildIndexMetadataGeneric,
  buildPostGraphJsonLd as buildPostGraphJsonLdGeneric,
  buildPostMetadata as buildPostMetadataGeneric,
  buildTagsBreadcrumbJsonLd as buildTagsBreadcrumbJsonLdGeneric,
  buildTagsMetadata as buildTagsMetadataGeneric,
} from '@/lib/content/seo'

export const LIBRARY_SECTION: ContentSection = {
  name: 'Library',
  basePath: '/library',
  feedPath: '/library/rss.xml',
  hasAuthorPages: true,
  description:
    'Comparisons, how-tos, and roundups for teams evaluating and building AI agents with Sim.',
}

export { buildArticleJsonLd, buildFaqJsonLd }

/** Post metadata plus the `text/markdown` alternate that `app/library.md/[slug]` serves. */
export function buildPostMetadata(post: ContentMeta): Metadata {
  const metadata = buildPostMetadataGeneric(post, LIBRARY_SECTION)
  return {
    ...metadata,
    alternates: {
      ...metadata.alternates,
      types: { ...metadata.alternates?.types, 'text/markdown': `${post.canonical}.md` },
    },
  }
}

export function buildPostGraphJsonLd(post: ContentMeta) {
  return buildPostGraphJsonLdGeneric(post, LIBRARY_SECTION)
}

export function buildCollectionPageJsonLd(
  posts: ContentMeta[],
  filter?: { tag?: string; page?: number }
) {
  return buildCollectionPageJsonLdGeneric(LIBRARY_SECTION, posts, filter)
}

export function buildIndexMetadata(input: { tag?: string; pageNum: number }) {
  return buildIndexMetadataGeneric(LIBRARY_SECTION, input)
}

export function buildTagsMetadata() {
  return buildTagsMetadataGeneric(LIBRARY_SECTION)
}

export function buildTagsBreadcrumbJsonLd() {
  return buildTagsBreadcrumbJsonLdGeneric(LIBRARY_SECTION)
}

export function buildAuthorMetadata(id: string, author?: Author) {
  return buildAuthorMetadataGeneric(LIBRARY_SECTION, id, author)
}

export function buildAuthorGraphJsonLd(author: Author) {
  return buildAuthorGraphJsonLdGeneric(LIBRARY_SECTION, author)
}
