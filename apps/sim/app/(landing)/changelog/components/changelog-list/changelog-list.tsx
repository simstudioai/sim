import type { ContentMeta } from '@/lib/content/schema'
import { ChangelogEntry } from '@/app/(landing)/changelog/components/changelog-list/components/changelog-entry'

interface ChangelogListProps {
  entries: ContentMeta[]
  basePath?: string
}

/** Chronological rows share the landing frame, with copy beside media and a stacked mobile layout. */
export function ChangelogList({ entries, basePath }: ChangelogListProps) {
  return (
    <section id='updates' aria-labelledby='updates-heading'>
      <h2 id='updates-heading' className='sr-only'>
        Product updates
      </h2>
      {entries.length > 0 ? (
        <ol className='divide-y divide-[var(--border)]'>
          {entries.map((entry, index) => (
            <li key={entry.slug} className='py-12 first:pt-0 last:pb-0 max-sm:py-8'>
              <ChangelogEntry entry={entry} priority={index === 0} basePath={basePath} />
            </li>
          ))}
        </ol>
      ) : (
        <p className='py-12 text-[var(--text-secondary)] text-md'>
          Product updates will appear here as they are published.
        </p>
      )}
    </section>
  )
}
