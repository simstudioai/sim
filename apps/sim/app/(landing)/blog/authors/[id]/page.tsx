import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.author.id === id)
  const author = posts[0]?.author
  const name = author?.name ?? 'Author'
  return {
    title: `${name} — Sim Blog`,
    description: `Read articles by ${name} on the Sim blog.`,
    alternates: { canonical: `https://sim.ai/blog/authors/${id}` },
    openGraph: {
      title: `${name} — Sim Blog`,
      description: `Read articles by ${name} on the Sim blog.`,
      url: `https://sim.ai/blog/authors/${id}`,
      siteName: 'Sim',
      type: 'profile',
      ...(author?.avatarUrl
        ? { images: [{ url: author.avatarUrl, width: 400, height: 400, alt: name }] }
        : {}),
    },
    twitter: {
      card: 'summary',
      title: `${name} — Sim Blog`,
      description: `Read articles by ${name} on the Sim blog.`,
      site: '@simdotai',
      ...(author?.xHandle ? { creator: `@${author.xHandle}` } : {}),
    },
  }
}

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter((p) => p.author.id === id)
  const author = posts[0]?.author
  if (!author) {
    return (
      <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
        <h1 className='font-[500] text-[32px] text-[var(--landing-text)]'>Author not found</h1>
      </main>
    )
  }
  const graphJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        name: author.name,
        url: `https://sim.ai/blog/authors/${author.id}`,
        sameAs: author.url ? [author.url] : [],
        image: author.avatarUrl,
        worksFor: {
          '@type': 'Organization',
          name: 'Sim',
          url: 'https://sim.ai',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://sim.ai' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://sim.ai/blog' },
          {
            '@type': 'ListItem',
            position: 3,
            name: author.name,
            item: `https://sim.ai/blog/authors/${author.id}`,
          },
        ],
      },
    ],
  }
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(graphJsonLd) }}
      />
      <div className='mb-6 flex items-center gap-3'>
        {author.avatarUrl ? (
          <Image
            src={author.avatarUrl}
            alt={author.name}
            width={40}
            height={40}
            className='rounded-full'
            unoptimized
          />
        ) : null}
        <h1 className='font-[500] text-[32px] text-[var(--landing-text)] leading-tight'>
          {author.name}
        </h1>
      </div>
      <div className='grid grid-cols-1 gap-8 sm:grid-cols-2'>
        {posts.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className='group'>
            <div className='overflow-hidden rounded-lg border border-[var(--landing-bg-elevated)]'>
              <Image
                src={p.ogImage}
                alt={p.title}
                width={600}
                height={315}
                className='h-[160px] w-full object-cover transition-transform group-hover:scale-[1.02]'
                unoptimized
              />
              <div className='p-3'>
                <div className='mb-1 text-[var(--landing-text-muted)] text-xs'>
                  {new Date(p.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <div className='font-[500] text-[var(--landing-text)] text-sm leading-tight'>
                  {p.title}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
