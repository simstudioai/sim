import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/library/registry'
import { buildPostGraphJsonLd, buildPostMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentPostPage } from '@/app/(landing)/components'

export const dynamicParams = false

export async function generateStaticParams() {
  const posts = await getAllPostMeta()
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return {}
  return buildPostMetadata(post)
}

export const revalidate = 86400

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) notFound()
  const related = await getRelatedPosts(slug, 3)

  return (
    <ContentPostPage
      basePath={LIBRARY_SECTION.basePath}
      backLabel='Back to Library'
      post={post}
      related={related}
      graphJsonLd={buildPostGraphJsonLd(post)}
      shareUrl={`${getBaseUrl()}${LIBRARY_SECTION.basePath}/${slug}`}
    />
  )
}
