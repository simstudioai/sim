import { ChipLink, cn } from '@sim/emcn'
import type { TagWithCount } from '@/lib/content/schema'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { PUBLIC_PAGE_TYPE } from '@/app/(landing)/components/landing-layout'

interface ContentTagsPageProps {
  /** Route base path, e.g. `/blog` or `/library`. */
  basePath: string
  tags: TagWithCount[]
  breadcrumbJsonLd: Record<string, unknown>
}

/** Shared "browse by tag" layout for a content section. */
export function ContentTagsPage({ basePath, tags, breadcrumbJsonLd }: ContentTagsPageProps) {
  return (
    <section className='mx-auto w-full max-w-[1728px] px-10 pt-[112px] max-sm:pt-12 max-md:px-7 max-lg:px-8 max-xl:px-9 max-xl:pt-20'>
      <JsonLd data={breadcrumbJsonLd} />
      <h1 className={cn('mb-6 text-[var(--text-primary)]', PUBLIC_PAGE_TYPE.title)}>
        Browse by tag
      </h1>
      <div className='flex flex-wrap gap-3'>
        <ChipLink href={basePath}>All</ChipLink>
        {tags.map((t) => (
          <ChipLink key={t.tag} href={`${basePath}?tag=${encodeURIComponent(t.tag)}`}>
            {t.tag} ({t.count})
          </ChipLink>
        ))}
      </div>
    </section>
  )
}
