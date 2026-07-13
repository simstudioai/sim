import type { Metadata } from 'next'
import { getAllPostMeta } from '@/lib/library/registry'
import { buildCollectionPageJsonLd, buildIndexMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentIndexPage } from '@/app/(landing)/components'

/**
 * Filtered/paginated variants render genuinely different lists, but only the
 * bare index is indexable — see `buildIndexMetadata` in `@/lib/content/seo`
 * for the shared noindex policy.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}): Promise<Metadata> {
  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))
  return buildIndexMetadata({ tag, pageNum })
}

export default async function LibraryIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}) {
  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))
  const posts = await getAllPostMeta()

  return (
    <ContentIndexPage
      basePath={LIBRARY_SECTION.basePath}
      heading='The Sim Library'
      subheading={LIBRARY_SECTION.description}
      posts={posts}
      page={pageNum}
      tag={tag}
      collectionJsonLd={buildCollectionPageJsonLd(posts)}
    />
  )
}
