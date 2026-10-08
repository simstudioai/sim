import type { ContentMeta } from '@/lib/content/schema'
import { ChangelogCard } from '@/app/(landing)/changelog/components/changelog-grid/components/changelog-card'

interface ChangelogGridProps {
  entries: ContentMeta[]
  featureLatest?: boolean
  basePath?: string
}

/** A featured story and two-column reading grid, using the customer-story composition. */
export function ChangelogGrid({ entries, featureLatest = false, basePath }: ChangelogGridProps) {
  return (
    <section
      id='updates'
      aria-labelledby='updates-heading'
      className='grid grid-cols-2 gap-x-8 gap-y-12 max-md:grid-cols-1'
    >
      <h2 id='updates-heading' className='sr-only'>
        Product updates
      </h2>
      {entries.length > 0 ? (
        entries.map((entry, index) => (
          <ChangelogCard
            key={entry.slug}
            entry={entry}
            featured={featureLatest && index === 0}
            priority={index === 0}
            basePath={basePath}
          />
        ))
      ) : (
        <p className='col-span-full py-12 text-[var(--text-secondary)] text-md'>
          Product updates will appear here as they are published.
        </p>
      )}
    </section>
  )
}
