'use client'

import type { ReactNode } from 'react'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { CompactSourceRow } from '@/platform/app/(shell)/_components/search/source-row'
import styles from '@/platform/app/(shell)/search/_components/search-surface/search-surface.module.css'
import { Button, Chip } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { FailureNotice } from '@/platform/design-system/components/status/status'
import { useSearchLandingHistory } from '@/platform/lib/data/search-history'

interface HistoryPaneProps {
  hidden: boolean
  isEmpty: boolean
  /** Shown when this list has nothing while the other one does. */
  emptyText: string
  children: ReactNode
}

/** Both panes keep their place in one grid cell, so switching lists never moves the layout. */
function HistoryPane({ hidden, isEmpty, emptyText, children }: HistoryPaneProps) {
  return (
    <div className={styles.historyList} inert={hidden}>
      {isEmpty ? (
        <p className={styles.historyEmpty} data-type='T060'>
          {emptyText}
        </p>
      ) : (
        children
      )}
    </div>
  )
}

interface SearchHistoryProps {
  userId: string
  onSearch: (query: string) => void
  children: ReactNode
}

/** The viewer's private shortcuts under the field, which stays centered whatever they contain. */
export function SearchHistory({ userId, onSearch, children }: SearchHistoryProps) {
  const { organization } = useOrganizationContext()
  const { failed, retrying, retry, sources, queries, selected, setSelection, clear, isClearing } =
    useSearchLandingHistory(organization.id, userId)
  return (
    <div className={styles.historyAnchor}>
      {children}
      <div className={styles.historyPanel}>
        {(sources.length > 0 || queries.length > 0) && (
          <section aria-label='Recent activity' className={styles.history}>
            <div className={styles.historyBar}>
              <div role='group' aria-label='History type' className={styles.historyTypes}>
                <Chip selected={selected === 'sources'} onClick={() => setSelection('sources')}>
                  Recently viewed
                </Chip>
                <Chip selected={selected === 'queries'} onClick={() => setSelection('queries')}>
                  Recent searches
                </Chip>
              </div>
              <Button variant='quiet' size='compact' disabled={isClearing} onClick={clear}>
                Clear history
              </Button>
            </div>
            <div className={styles.historyLists}>
              <HistoryPane
                hidden={selected !== 'sources'}
                isEmpty={sources.length === 0}
                emptyText='Sources you open will appear here.'
              >
                {sources.map((source) => (
                  <CompactSourceRow key={source.url} source={source} />
                ))}
              </HistoryPane>
              <HistoryPane
                hidden={selected !== 'queries'}
                isEmpty={queries.length === 0}
                emptyText='Your recent searches will appear here.'
              >
                {queries.map(({ query }) => (
                  <ControlRow
                    key={query}
                    label={query}
                    icon='I046'
                    render={<button type='button' onClick={() => onSearch(query)} />}
                  />
                ))}
              </HistoryPane>
            </div>
          </section>
        )}
        {failed && (
          <div className={styles.historyError}>
            <FailureNotice
              message='Recent activity couldn’t load.'
              retrying={retrying}
              onRetry={retry}
            />
          </div>
        )}
      </div>
    </div>
  )
}
