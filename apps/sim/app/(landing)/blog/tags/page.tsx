import type { Metadata } from 'next'
import { ChipLink } from '@/components/emcn'
import { getAllTags } from '@/lib/blog/registry'
import { SITE_URL } from '@/lib/core/utils/urls'

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Browse Sim blog posts by topic: AI agents, workflows, integrations, and more.',
  alternates: { canonical: `${SITE_URL}/blog/tags` },
  openGraph: {
    title: 'Blog Tags | Sim',
    description: 'Browse Sim blog posts by topic: AI agents, workflows, integrations, and more.',
    url: `${SITE_URL}/blog/tags`,
    siteName: 'Sim',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Blog Tags | Sim',
    description: 'Browse Sim blog posts by topic: AI agents, workflows, integrations, and more.',
    site: '@simdotai',
  },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
    { '@type': 'ListItem', position: 3, name: 'Tags', item: `${SITE_URL}/blog/tags` },
  ],
}

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <section className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <h1 className='mb-6 text-[32px] text-[var(--text-primary)] leading-tight'>Browse by tag</h1>
      <div className='flex flex-wrap gap-3'>
        <ChipLink href='/blog' className='border border-[var(--border-1)]'>
          All
        </ChipLink>
        {tags.map((t) => (
          <ChipLink
            key={t.tag}
            href={`/blog?tag=${encodeURIComponent(t.tag)}`}
            className='border border-[var(--border-1)]'
          >
            {t.tag} ({t.count})
          </ChipLink>
        ))}
      </div>
    </section>
  )
}
