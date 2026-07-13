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

export const BLOG_SECTION: ContentSection = {
  name: 'Blog',
  basePath: '/blog',
  description: 'Announcements, insights, and guides for building AI agents.',
}

export { buildArticleJsonLd, buildFaqJsonLd, buildPostMetadata }

export function buildPostGraphJsonLd(post: ContentMeta) {
  return buildPostGraphJsonLdGeneric(post, BLOG_SECTION)
}

export function buildCollectionPageJsonLd(posts: ContentMeta[]) {
  return buildCollectionPageJsonLdGeneric(BLOG_SECTION, posts)
}

export function buildIndexMetadata(input: { tag?: string; pageNum: number }) {
  return buildIndexMetadataGeneric(BLOG_SECTION, input)
}

export function buildTagsMetadata() {
  return buildTagsMetadataGeneric(BLOG_SECTION)
}

export function buildTagsBreadcrumbJsonLd() {
  return buildTagsBreadcrumbJsonLdGeneric(BLOG_SECTION)
}

export function buildAuthorMetadata(id: string, author?: Author) {
  return buildAuthorMetadataGeneric(BLOG_SECTION, id, author)
}

export function buildAuthorGraphJsonLd(author: Author) {
  return buildAuthorGraphJsonLdGeneric(BLOG_SECTION, author)
}
