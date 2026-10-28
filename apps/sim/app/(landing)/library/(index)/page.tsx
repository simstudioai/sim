import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveContentPage, selectVisiblePosts } from '@/lib/content/index-list'
import { getAllPostMeta } from '@/lib/library/registry'
import { buildCollectionPageJsonLd, buildIndexMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentIndexPage } from '@/app/(landing)/components'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}): Promise<Metadata> {
  const { page, tag } = await searchParams
  const posts = await getAllPostMeta()
  const pageNum = resolveContentPage(posts, { page, tag })
  if (pageNum === null) notFound()
  return buildIndexMetadata({ tag, pageNum })
}

export default async function LibraryIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}) {
  const { page, tag } = await searchParams
  const posts = await getAllPostMeta()
  const pageNum = resolveContentPage(posts, { page, tag })
  if (pageNum === null) notFound()

  return (
    <ContentIndexPage
      basePath={LIBRARY_SECTION.basePath}
      heading='The Sim Library'
      subheading={LIBRARY_SECTION.description}
      posts={posts}
      page={pageNum}
      tag={tag}
      collectionJsonLd={buildCollectionPageJsonLd(
        selectVisiblePosts(posts, { tag, page: pageNum }),
        { tag, page: pageNum }
      )}
    />
  )
}
