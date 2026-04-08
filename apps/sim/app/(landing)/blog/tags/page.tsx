import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllTags } from '@/lib/blog/registry'

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Browse Sim blog posts by topic — AI agents, workflows, integrations, and more.',
  alternates: { canonical: 'https://sim.ai/blog/tags' },
  openGraph: {
    title: 'Blog Tags | Sim',
    description: 'Browse Sim blog posts by topic — AI agents, workflows, integrations, and more.',
    url: 'https://sim.ai/blog/tags',
    siteName: 'Sim',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Blog Tags | Sim',
    description: 'Browse Sim blog posts by topic — AI agents, workflows, integrations, and more.',
    site: '@simdotai',
  },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://sim.ai' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://sim.ai/blog' },
    { '@type': 'ListItem', position: 3, name: 'Tags', item: 'https://sim.ai/blog/tags' },
  ],
}

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <h1 className='mb-6 font-[500] text-[32px] text-[var(--landing-text)] leading-tight'>
        Browse by tag
      </h1>
      <div className='flex flex-wrap gap-3'>
        <Link
          href='/blog'
          className='rounded-full border border-[var(--landing-border-strong)] px-3 py-1 text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
        >
          All
        </Link>
        {tags.map((t) => (
          <Link
            key={t.tag}
            href={`/blog?tag=${encodeURIComponent(t.tag)}`}
            className='rounded-full border border-[var(--landing-border-strong)] px-3 py-1 text-[var(--landing-text)] text-sm transition-colors hover:bg-[var(--landing-bg-elevated)]'
          >
            {t.tag} ({t.count})
          </Link>
        ))}
      </div>
    </main>
  )
}
