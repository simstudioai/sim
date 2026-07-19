import { ChipLink } from '@sim/emcn'
import type { TagWithCount } from '@/lib/content/schema'
import { JsonLd } from '@/app/(landing)/components/json-ld'

interface ContentTagsPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  tags: TagWithCount[]
  breadcrumbJsonLd: Record<string, unknown>
}

/** Shared "browse by tag" layout for a content section. */
export function ContentTagsPage({ basePath, tags, breadcrumbJsonLd }: ContentTagsPageProps) {
  return (
    <section className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <JsonLd data={breadcrumbJsonLd} />
      <h1 className='mb-6 text-[32px] text-[var(--text-primary)] leading-tight'>Browse by tag</h1>
      <div className='flex flex-wrap gap-3'>
        <ChipLink href={basePath} className='border border-[var(--border-1)]'>
          All
        </ChipLink>
        {tags.map((t) => (
          <ChipLink
            key={t.tag}
            href={`${basePath}?tag=${encodeURIComponent(t.tag)}`}
            className='border border-[var(--border-1)]'
          >
            {t.tag} ({t.count})
          </ChipLink>
        ))}
      </div>
    </section>
  )
}
