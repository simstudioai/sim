'use client'

import { type FormEvent, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Input } from '@sim/emcn/field/inputs'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { FailureNotice } from '@sim/emcn/status'
import { PageColumn } from '@sim/emcn-platform/page-column'
import { RecentItems } from '@sim/emcn-platform/recent-items'
import { LiveChat } from '@/platform/app/(shell)/_components/chat/live/live-chat'
import { SearchResults } from '@/platform/app/(shell)/_components/search/search-results'
import styles from '@/platform/app/(shell)/search/_components/search-surface/search-surface.module.css'
import { useSearchSurface } from '@/platform/lib/data/search'

interface SearchSurfaceProps {
  chatId?: string
}

export function SearchSurface({ chatId }: SearchSurfaceProps) {
  const surface = useSearchSurface(chatId)
  const { mode, query, assistantAvailable, history } = surface
  const [draft, setDraft] = useState(query)
  const [draftQuery, setDraftQuery] = useState(query)
  if (draftQuery !== query) {
    setDraftQuery(query)
    setDraft(query)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    surface.submit(draft)
  }
  const modeSwitch = assistantAvailable && (
    <SegmentedControl
      label='Search mode'
      options={[
        { value: 'search', label: 'Search' },
        { value: 'assistant', label: 'Assistant' },
      ]}
      value={mode}
      onSelect={surface.setMode}
    />
  )
  return (
    <div className={styles.surface}>
      {/* The conversation stays mounted under Search so a running turn keeps streaming. */}
      {assistantAvailable && (mode === 'assistant' || surface.assistantStarted) && (
        <div className={styles.assistant} hidden={mode !== 'assistant'}>
          <LiveChat
            chatId={chatId}
            destination='assistant'
            chatPath={(id) => `/search/chat/${id}`}
            summaryRequest={surface.pendingSummary}
            onSummaryConsumed={surface.consumeSummary}
            header={<div className={styles.switch}>{modeSwitch}</div>}
          />
        </div>
      )}
      {mode === 'search' && (
        <div className={styles.search}>
          <header className={styles.header} data-desktop-drag=''>
            <h1 data-type='T039'>Search {surface.organizationName}</h1>
            {modeSwitch}
          </header>
          <PageColumn>
            <div className={styles.column}>
              <form className={styles.field} onSubmit={submit} role='search'>
                <Input
                  label='Search'
                  placeholder='Search your company’s knowledge…'
                  value={draft}
                  onChange={setDraft}
                />
                {surface.searching ? (
                  <Button variant='muted' size='compact' onClick={surface.stop}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant='primary'
                    size='compact'
                    disabled={!draft.trim()}
                    onClick={() => surface.submit(draft)}
                  >
                    Search
                  </Button>
                )}
                {query && (
                  <Button
                    variant='muted'
                    size='compact'
                    onClick={() => {
                      setDraft('')
                      surface.clear()
                    }}
                  >
                    New search
                  </Button>
                )}
              </form>
              {query || surface.filtered ? (
                <SearchResults results={surface.results} />
              ) : history.status === 'error' ? (
                <FailureNotice message='Your history could not load.' onRetry={history.retry} />
              ) : history.status === 'loading' ? null : !history.sources.length &&
                !history.queries.length ? (
                <EmptyState title='No search history yet' />
              ) : (
                <section className={styles.history} aria-label='Search history'>
                  {history.sources.length > 0 && (
                    <RecentItems
                      label='Recently viewed'
                      items={history.sources}
                      onSelect={history.openSource}
                    />
                  )}
                  {history.queries.length > 0 && (
                    <RecentItems
                      label='Recent searches'
                      items={history.queries}
                      onSelect={(id) => {
                        setDraft(id)
                        surface.submit(id)
                      }}
                    />
                  )}
                  <Button variant='muted' size='compact' onClick={history.clear}>
                    Clear history
                  </Button>
                </section>
              )}
            </div>
          </PageColumn>
        </div>
      )}
    </div>
  )
}
