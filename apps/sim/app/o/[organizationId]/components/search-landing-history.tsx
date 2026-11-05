'use client'

import type { ReactNode } from 'react'
import { Chip, cn } from '@sim/emcn'
import { Clock } from '@sim/emcn/icons'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { useSearchLandingHistory } from '@/app/o/[organizationId]/components/use-search-landing-history'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'

interface SearchLandingHistoryProps {
  organizationId: string
  userId: string
  onSearch: (query: string) => void
  children: ReactNode
}

/** Private shortcuts under the composer; ordinary buttons retain native Tab/Enter navigation. */
export function SearchLandingHistory({
  organizationId,
  userId,
  onSearch,
  children,
}: SearchLandingHistoryProps) {
  const { failed, retrying, retry, sources, queries, selected, setSelection, clear, isClearing } =
    useSearchLandingHistory(organizationId, userId)
  return (
    <div className={cn('relative w-full min-w-0', inter.className)}>
      {children}
      <div className='relative md:absolute md:inset-x-0 md:top-full'>
        {(sources.length > 0 || queries.length > 0) && (
          <section aria-label='Recent activity' className='mt-6 px-2'>
            <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
              <div role='group' aria-label='History type' className='flex items-center gap-1'>
                <Chip
                  active={selected === 'sources'}
                  aria-pressed={selected === 'sources'}
                  onClick={() => setSelection('sources')}
                >
                  Recently viewed
                </Chip>
                <Chip
                  active={selected === 'queries'}
                  aria-pressed={selected === 'queries'}
                  onClick={() => setSelection('queries')}
                >
                  Recent searches
                </Chip>
              </div>
              <Chip disabled={isClearing} onClick={clear}>
                Clear history
              </Chip>
            </div>
            <div className='grid grid-cols-1'>
              <div
                className={cn(
                  'col-start-1 row-start-1 min-w-0',
                  selected !== 'sources' && 'invisible'
                )}
                inert={selected !== 'sources'}
                aria-hidden={selected !== 'sources'}
              >
                {sources.length > 0 ? (
                  sources.map((source) => <SourceCard key={source.url} source={source} dense />)
                ) : (
                  <p className='px-2 py-2 text-[var(--text-tertiary)] text-small'>
                    Sources you open will appear here.
                  </p>
                )}
              </div>
              <div
                className={cn(
                  'col-start-1 row-start-1 min-w-0',
                  selected !== 'queries' && 'invisible'
                )}
                inert={selected !== 'queries'}
                aria-hidden={selected !== 'queries'}
              >
                {queries.length > 0 ? (
                  queries.map(({ query }) => (
                    <div key={query} className='py-1'>
                      <Chip fullWidth leftIcon={Clock} onClick={() => onSearch(query)}>
                        {query}
                      </Chip>
                    </div>
                  ))
                ) : (
                  <p className='px-2 py-2 text-[var(--text-tertiary)] text-small'>
                    Your recent searches will appear here.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
        {failed && (
          <div className='mt-6 flex items-center gap-2 px-4 text-[var(--text-tertiary)] text-small'>
            Recent activity couldn’t load.
            <Chip onClick={retry} disabled={retrying}>
              Try again
            </Chip>
          </div>
        )}
      </div>
    </div>
  )
}
