import type { ContentMeta } from '@/lib/content/schema'

export const POSTS_PER_PAGE = 20
export const FEATURED_COUNT = 3

interface PaginatedContentPosts {
  featured: ContentMeta[]
  remaining: ContentMeta[]
  totalPages: number
}

/**
 * Reproduces `ContentIndexPage`'s render logic for a given `tag`/`page`
 * combination: tag-filtered, date-sorted, with up to `FEATURED_COUNT`
 * featured posts (explicit `post.featured` first, falling back to the most
 * recent) carved out of the paginated pool and returned only on page 1.
 * Shared by `ContentIndexPage` itself and `selectVisiblePosts` below, so
 * every consumer stays in lockstep with what's actually rendered.
 */
export function paginateContentPosts(
  posts: ContentMeta[],
  { tag, page }: { tag?: string; page: number }
): PaginatedContentPosts {
  const filtered = tag ? posts.filter((p) => p.tags.includes(tag)) : posts
  const dateSorted = [...filtered].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  const explicitlyFeatured = dateSorted.filter((p) => p.featured).slice(0, FEATURED_COUNT)
  const featuredPosts =
    explicitlyFeatured.length > 0 ? explicitlyFeatured : dateSorted.slice(0, FEATURED_COUNT)
  const featuredSlugs = new Set(featuredPosts.map((p) => p.slug))
  const paginated = dateSorted.filter((p) => !featuredSlugs.has(p.slug))

  const totalPages = Math.max(1, Math.ceil(paginated.length / POSTS_PER_PAGE))
  const start = (page - 1) * POSTS_PER_PAGE

  return {
    featured: page === 1 ? featuredPosts : [],
    remaining: paginated.slice(start, start + POSTS_PER_PAGE),
    totalPages,
  }
}

/**
 * Flat, render-order post list (featured then remaining) for a given
 * `tag`/`page` combination - used to keep `buildCollectionPageJsonLd`'s
 * `mainEntity` ItemList in sync with the posts actually visible on a
 * filtered or paginated index URL, instead of the full unfiltered catalog.
 */
export function selectVisiblePosts(
  posts: ContentMeta[],
  options: { tag?: string; page: number }
): ContentMeta[] {
  const { featured, remaining } = paginateContentPosts(posts, options)
  return [...featured, ...remaining]
}
