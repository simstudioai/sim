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
  buildPostMetadata,
  buildTagsBreadcrumbJsonLd as buildTagsBreadcrumbJsonLdGeneric,
  buildTagsMetadata as buildTagsMetadataGeneric,
} from '@/lib/content/seo'

export const LIBRARY_SECTION: ContentSection = {
  name: 'Library',
  basePath: '/library',
  description:
    'Comparisons, how-tos, and roundups for teams evaluating and building AI agents with Sim.',
}

export { buildArticleJsonLd, buildFaqJsonLd, buildPostMetadata }

export function buildPostGraphJsonLd(post: ContentMeta) {
  return buildPostGraphJsonLdGeneric(post, LIBRARY_SECTION)
}

export function buildCollectionPageJsonLd() {
  return buildCollectionPageJsonLdGeneric(LIBRARY_SECTION)
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

export function buildAuthorMetadata(author?: Author) {
  return buildAuthorMetadataGeneric(LIBRARY_SECTION, author)
}

export function buildAuthorGraphJsonLd(author: Author) {
  return buildAuthorGraphJsonLdGeneric(LIBRARY_SECTION, author)
}
