'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'
import { SourceRow } from '@/app/(product)/_components/source-row/source-row'
import type { ChatSource } from '@/platform/lib/data/models/chat'

/** Every document one answer cited, in the same row a search result and the reply's list use. */
export function CitedSources({ sources }: { sources: readonly ChatSource[] }) {
  return (
    <section className={styles.sources} aria-label='Cited sources'>
      {sources.length ? (
        <div className={styles.sourceList}>
          {sources.map((source) => (
            <SourceRow key={source.id} row={source} />
          ))}
        </div>
      ) : (
        <EmptyState title='No cited sources are available for this response.' />
      )}
    </section>
  )
}
