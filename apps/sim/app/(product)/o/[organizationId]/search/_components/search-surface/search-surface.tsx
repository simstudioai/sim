'use client'

import type { FormEvent } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Input } from '@sim/emcn/field/inputs'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { FailureNotice } from '@sim/emcn/status'
import { PageColumn } from '@sim/emcn-platform/page-column'
import { RecentItems } from '@sim/emcn-platform/recent-items'
import { LiveChat } from '@/app/(product)/_components/chat/live/live-chat'
import { SearchResults } from '@/app/(product)/_components/search/search-results'
import styles from '@/app/(product)/o/[organizationId]/search/_components/search-surface/search-surface.module.css'
import type { OpenedChat } from '@/platform/lib/data/chat'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSearchField, useSearchSurface } from '@/platform/lib/data/search'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface SearchFieldProps {
  query: string
  searching: boolean
  onSubmit: (value: string) => void
  onStop: () => void
  newSearch?: { label: string; disabled: boolean; onStart: () => void }
}

function SearchField({ query, searching, onSubmit, onStop, newSearch }: SearchFieldProps) {
  const field = useSearchField({ query, searching, onSubmit, onStop })
  function submit(event: FormEvent) {
    event.preventDefault()
    field.submit()
  }
  return (
    <form className={styles.field} onSubmit={submit} role='search'>
      <Input
        label='Search'
        placeholder='Search your company’s knowledge…'
        value={field.value}
        onChange={field.setValue}
        inputRef={field.inputRef}
      />
      {searching ? (
        <Button variant='muted' size='compact' onClick={field.submitOrStop}>
          Stop
        </Button>
      ) : (
        <Button
          variant='primary'
          size='compact'
          disabled={!field.canSubmit}
          onClick={field.submitOrStop}
        >
          Search
        </Button>
      )}
      {newSearch && (
        <Button
          variant='muted'
          size='compact'
          disabled={newSearch.disabled}
          onClick={newSearch.onStart}
        >
          {newSearch.label}
        </Button>
      )}
    </form>
  )
}

interface SearchSurfaceProps {
  /** The Assistant chat its route's gate opened; absent on Search and a new conversation. */
  chat?: OpenedChat
}

export function SearchSurface({ chat }: SearchSurfaceProps) {
  const surface = useSearchSurface(chat?.id)
  const scope = useSurfaceScope()
  const { mode, query, assistantAvailable, history } = surface
  const newAction = surface.canStartNew
    ? { label: surface.newLabel, disabled: surface.startingNew, onStart: surface.startNew }
    : undefined
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
    <main className={styles.surface}>
      {/* The conversation stays mounted under Search so a running turn keeps streaming. */}
      {assistantAvailable && (mode === 'assistant' || surface.assistantStarted) && (
        <div className={styles.assistant} hidden={mode !== 'assistant'}>
          <LiveChat
            key={surface.conversationInstance}
            chat={chat}
            destination='assistant'
            chatPath={(id) => surfaceHref(scope, `/search/chat/${id}`)}
            searchView={mode}
            summaryRequest={surface.pendingSummary}
            onSummaryConsumed={surface.consumeSummary}
            header={
              <div className={styles.switch}>
                {modeSwitch}
                {mode === 'assistant' && newAction && (
                  <Button
                    variant='quiet'
                    size='compact'
                    icon='I074'
                    disabled={newAction.disabled}
                    onClick={newAction.onStart}
                  >
                    {newAction.label}
                  </Button>
                )}
              </div>
            }
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
              <SearchField
                key={query}
                query={query}
                searching={surface.searching}
                onSubmit={surface.submit}
                onStop={surface.stop}
                newSearch={newAction}
              />
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
                      onSelect={surface.submit}
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
    </main>
  )
}
