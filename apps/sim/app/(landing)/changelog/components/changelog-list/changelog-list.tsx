import type { ContentMeta } from '@/lib/content/schema'
import { ChangelogEntry } from '@/app/(landing)/changelog/components/changelog-list/components/changelog-entry'

interface ChangelogListProps {
  entries: ContentMeta[]
  basePath?: string
}

/** A chronological index keeps demos and detailed copy on each update's page. */
export function ChangelogList({ entries, basePath }: ChangelogListProps) {
  return (
    <section id='updates' aria-labelledby='updates-heading'>
      <h2 id='updates-heading' className='sr-only'>
        Product updates
      </h2>
      {entries.length > 0 ? (
        <ol className='space-y-10 max-sm:space-y-8'>
          {entries.map((entry) => (
            <li key={entry.slug}>
              <ChangelogEntry entry={entry} basePath={basePath} />
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
