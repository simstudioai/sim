import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { BLOG_SECTION, buildPostGraphJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { ContentPostPage } from '@/app/(landing)/components'

/**
 * Unknown params 404 before rendering when this route is prerendered. The production image renders
 * every route dynamically, so there the page's own `notFound()` is what 404s - which is why no
 * `loading.tsx` may wrap this segment: its Suspense boundary commits a 200 before `notFound()` runs.
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
  return buildPostMetadata(post, BLOG_SECTION)
}

export const revalidate = 86400

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post || post.draft) notFound()
  const related = await getRelatedPosts(slug)

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
