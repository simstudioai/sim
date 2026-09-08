import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/library/registry'
import { buildPostGraphJsonLd, buildPostMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentPostPage } from '@/app/(landing)/components'

/** Unknown slugs reach the section 404 while known pages remain pre-rendered. */
export const dynamicParams = true

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
  if (!post || post.draft) return {}
  return buildPostMetadata(post)
}

export const revalidate = 86400

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post || post.draft) notFound()
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
