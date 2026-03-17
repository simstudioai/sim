import type { Metadata } from 'next'
import { getAllPostMeta } from '@/lib/blog/registry'
import { StudioContent } from '@/app/(landing)/blog/studio-content'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Announcements, insights, and guides from the Sim team.',
}

export default async function StudioIndex({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>
}) {
  const { tag, q } = await searchParams
  const all = await getAllPostMeta()

  const pickAuthor = (a: { name: string; avatarUrl?: string }) => ({
    name: a.name,
    avatarUrl: a.avatarUrl,
  })

  const posts = all.map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    date: p.date,
    ogImage: p.ogImage,
    readingTime: p.readingTime,
    tags: p.tags,
    author: pickAuthor(p.author),
    authors: p.authors?.map(pickAuthor),
    featured: p.featured ?? false,
  }))

  const studioJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Blog',
    url: 'https://sim.ai/blog',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(studioJsonLd) }}
      />
      <StudioContent posts={posts} initialTag={tag ?? null} initialQuery={q ?? ''} />
    </>
  )
}
