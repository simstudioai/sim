'use client'

import { type ReactNode, useState } from 'react'
import { Chip, cn, toast } from '@sim/emcn'
import { Clock } from '@sim/emcn/icons'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import { useClearSearchHistory, useSearchHistory } from '@/hooks/queries/search-history'

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
  const history = useSearchHistory(organizationId)
  const clear = useClearSearchHistory(organizationId, userId)
  const [selection, setSelection] = useState<'sources' | 'queries' | null>(null)
  const data = history.isError ? undefined : history.data
  const sources = data?.sources.slice(0, 5) ?? []
  const queries = data?.queries.slice(0, 5) ?? []
  const selected = selection ?? (sources.length > 0 ? 'sources' : 'queries')
  return (
    <div className={cn('w-full min-w-0', inter.className)}>
      {children}
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
            <Chip
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(undefined, { onError: (error) => toast.error(error.message) })
              }
            >
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
      {history.isError && (
        <div className='mt-6 flex items-center gap-2 px-4 text-[var(--text-tertiary)] text-small'>
          Recent activity couldn’t load.
          <Chip onClick={() => void history.refetch()} disabled={history.isFetching}>
            Try again
          </Chip>
        </div>
      )}
    </div>
  )
}
