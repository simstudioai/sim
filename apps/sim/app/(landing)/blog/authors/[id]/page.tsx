import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllPostMeta } from '@/lib/blog/registry'
import { BLOG_SECTION, buildAuthorGraphJsonLd, buildAuthorMetadata } from '@/lib/blog/seo'
import { ContentAuthorPage } from '@/app/(landing)/components'

export const revalidate = 3600

/**
 * Unknown params must 404 before rendering: `notFound()` during render streams this segment's
 * `loading.tsx` with a 200 status first.
 */
export const dynamicParams = false

export async function generateStaticParams() {
  const ids = new Set((await getAllPostMeta()).flatMap((p) => p.authors.map((a) => a.id)))
  return [...ids].map((id) => ({ id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.authors.some((a) => a.id === id))
  const author = posts[0]?.authors.find((a) => a.id === id)
  if (!author) return {}
  return buildAuthorMetadata(id, author)
}

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.authors.some((a) => a.id === id))
  const author = posts[0]?.authors.find((a) => a.id === id)
  if (!author) notFound()

  return (
    <ContentAuthorPage
      basePath={BLOG_SECTION.basePath}
      sectionName={BLOG_SECTION.name}
      authorName={author.name}
      authorAvatarUrl={author.avatarUrl}
      posts={posts}
      graphJsonLd={buildAuthorGraphJsonLd(author)}
    />
  )
}
