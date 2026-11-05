'use client'

import type { KeyboardEvent } from 'react'
import type { SearchResultsData } from '@/platform/app/(shell)/_components/search/model'
import styles from '@/platform/app/(shell)/_components/search/search.module.css'
import { SourceRow } from '@/platform/app/(shell)/_components/search/source-row'
import { Button, DateRangePicker, InlineNotice, Select } from '@/platform/design-system/components'

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('[data-source-link]')]
  const index = links.indexOf(document.activeElement as HTMLAnchorElement)
  const next = links[index + (event.key === 'ArrowDown' ? 1 : -1)]
  if (next) {
    event.preventDefault()
    next.focus()
  }
}

export function SearchResults({ results }: { results: SearchResultsData }) {
  const { status, rows, filters } = results
  return (
    <div className={styles.results} aria-busy={status === 'searching' || status === 'updating'}>
      {status === 'searching' && (
        <p className={styles.quiet} data-type='T048' role='status'>
          Searching
        </p>
      )}
      {status === 'updating' && (
        <p className={styles.quiet} data-type='T048' role='status'>
          Updating results
        </p>
      )}
      {status === 'needs-range' && <p data-type='T052'>Choose the days to search.</p>}
      {status === 'error' && (
        <InlineNotice
          intent='danger'
          message='Search couldn’t run.'
          action={
            <Button variant='muted' size='compact' onClick={results.retry}>
              Try again
            </Button>
          }
        />
      )}
      {filters && (
        <div className={styles.filters} role='group' aria-label='Search filters'>
          <Select
            label='Filter by source'
            value={filters.source.value}
            options={filters.source.options.map(({ id, label }) => ({ value: id, label }))}
            onValueChange={filters.source.onChange}
          />
          <Select
            label='Filter by date'
            value={filters.updated.value}
            options={filters.updated.options.map(({ id, label }) => ({ value: id, label }))}
            onValueChange={filters.updated.onChange}
          />
          {filters.range && (
            <DateRangePicker
              label='Updated between'
              value={
                filters.range.from && filters.range.to
                  ? { start: filters.range.from, end: filters.range.to }
                  : null
              }
              onValueChange={(range) => {
                if (range) filters.range?.onChange(range.start, range.end)
              }}
            />
          )}
        </div>
      )}
      {results.empty && (
        <p className={styles.quiet} data-type='T052'>
          Search found no results.
        </p>
      )}
      {results.noApps && (
        <InlineNotice
          message='No connected apps are available for this search.'
          action={
            <a className={styles.link} data-type='T048' href={results.noApps.href}>
              Connect apps
            </a>
          }
        />
      )}
      {results.someAppsUnavailable && (
        <p className={styles.quiet} data-type='T052' role='status'>
          Some apps couldn’t be searched. Showing available results.
        </p>
      )}
      {results.partial && (
        <p className={styles.quiet} data-type='T052'>
          Coverage is incomplete. Narrow the query or ask Assistant to refine it.
        </p>
      )}
      <div
        className={styles.rows}
        role='region'
        aria-label='Search results'
        aria-busy={status === 'updating'}
        onKeyDown={moveFocus}
      >
        {rows.map((row) => (
          <SourceRow
            key={row.id}
            row={row}
            onOpen={results.onOpen}
            onCopyLink={results.onCopyLink}
            onSummarize={results.onSummarize}
          />
        ))}
      </div>
    </div>
  )
}
