import type { Metadata } from 'next'
import { getAllPostMeta, getPostBySlug, getRelatedPosts } from '@/lib/blog/registry'
import { BLOG_SECTION, buildPostGraphJsonLd, buildPostMetadata } from '@/lib/blog/seo'
import { getBaseUrl } from '@/lib/core/utils/urls'
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
  return buildPostMetadata(post)
}

export const revalidate = 86400

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug)
  const related = await getRelatedPosts(slug, 3)

  return (
    <ContentPostPage
      basePath={BLOG_SECTION.basePath}
      backLabel='Back to Blog'
      post={post}
      related={related}
      graphJsonLd={buildPostGraphJsonLd(post)}
      shareUrl={`${getBaseUrl()}${BLOG_SECTION.basePath}/${slug}`}
    />
  )
}
