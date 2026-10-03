import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { BLOG_SECTION, buildPostGraphJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { ContentPostPage } from '@/app/(landing)/components'

/**
 * Unknown params must 404 before rendering: `notFound()` during render streams this segment's
 * `loading.tsx` with a 200 status first.
 */
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
      basePath={BLOG_SECTION.basePath}
      backLabel='Back to Blog'
      post={post}
      related={related}
      graphJsonLd={buildPostGraphJsonLd(post)}
    />
  )
}
