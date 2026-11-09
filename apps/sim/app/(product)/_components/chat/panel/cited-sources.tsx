'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import type { ChatSource } from '@/app/(product)/_components/chat/model'
import styles from '@/app/(product)/_components/chat/panel/panels.module.css'

/** Every document one answer cited, each opening at its source. */
export function CitedSources({ sources }: { sources: readonly ChatSource[] }) {
  return (
    <section className={styles.sources} aria-label='Cited sources'>
      {sources.length ? (
        <ul className={styles.sourceList}>
          {sources.map((source) => (
            <ActivityRow
              key={source.url}
              title={source.title}
              detail={source.site}
              onOpen={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
            />
          ))}
        </ul>
      ) : (
        <EmptyState title='No cited sources are available for this response.' />
      )}
    </section>
  )
}
