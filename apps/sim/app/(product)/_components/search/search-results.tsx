'use client'

import type { KeyboardEvent } from 'react'
import { ControlRow } from '@sim/emcn/button/control-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import type { SearchResultsData } from '@/app/(product)/_components/search/model'
import styles from '@/app/(product)/_components/search/search.module.css'
import { SourceRow } from '@/app/(product)/_components/source-row/source-row'

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
      {status === 'needs-range' && <p data-type='T052'>Choose the days to search.</p>}
      {status === 'error' && (
        <FailureNotice message='Search couldn’t run.' onRetry={results.retry} />
      )}
      {filters && (
        <div className={styles.filters} role='group' aria-label='Search filters'>
          <ChoiceMenu
            label='Filter by source'
            value={filters.source.value}
            options={filters.source.options.map(({ id, label }) => ({ value: id, label }))}
            onValueChange={filters.source.onChange}
          />
          <ChoiceMenu
            label='Filter by date'
            value={filters.updated.value}
            options={filters.updated.options.map(({ id, label }) => ({ value: id, label }))}
            onValueChange={filters.updated.onChange}
          />
          {filters.range && (
            <DateRangePicker
              label='Updated between'
              labelHidden
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
      {results.empty && !results.noApps && <EmptyState title='Search found no results.' />}
      {results.noApps && (
        <InlineNotice
          message='No connected apps are available for this search.'
          action={
            <ControlRow
              render={<Link href={results.noApps.href} />}
              label='Connect apps'
              trailingIcon='I030'
            />
          }
        />
      )}
      {results.someAppsUnavailable && (
        <InlineNotice
          intent='warning'
          message='Some apps couldn’t be searched. Showing available results.'
        />
      )}
      {results.partial && (
        <InlineNotice
          intent='warning'
          message='Coverage is incomplete. Narrow the query or ask Assistant to refine it.'
        />
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
            onSummarize={results.onSummarize}
          />
        ))}
      </div>
    </div>
  )
}
