import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllPostMeta } from '@/lib/blog/registry'
import { BLOG_SECTION, buildCollectionPageJsonLd, buildIndexMetadata } from '@/lib/blog/seo'
import { resolveContentPage, selectVisiblePosts } from '@/lib/content/index-list'
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

export default async function BlogIndex({
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
      basePath={BLOG_SECTION.basePath}
      heading='Latest from Sim'
      subheading={BLOG_SECTION.description}
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
