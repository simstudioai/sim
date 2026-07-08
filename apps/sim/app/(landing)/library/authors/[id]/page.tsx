import type { Metadata } from 'next'
import { getAllPostMeta } from '@/lib/library/registry'
import { buildAuthorGraphJsonLd, buildAuthorMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentAuthorPage } from '@/app/(landing)/components'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.author.id === id)
  return buildAuthorMetadata(id, posts[0]?.author)
}

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.author.id === id)
  const author = posts[0]?.author

  return (
    <ContentAuthorPage
      basePath={LIBRARY_SECTION.basePath}
      authorName={author?.name}
      authorAvatarUrl={author?.avatarUrl}
      posts={posts}
      graphJsonLd={author ? buildAuthorGraphJsonLd(author) : undefined}
    />
  )
}
