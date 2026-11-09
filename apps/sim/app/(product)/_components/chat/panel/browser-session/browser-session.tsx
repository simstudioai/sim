'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Input } from '@sim/emcn/field/inputs'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import styles from '@/app/(product)/_components/chat/panel/browser-session/browser-session.module.css'
import { FindBar } from '@/app/(product)/_components/find-bar/find-bar'
import { useBrowserPanel } from '@/platform/lib/data/browser-panel'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface BrowserSessionProps {
  scopeId: string
  /** Whether this tab is on screen in an open panel. */
  visible: boolean
}

/**
 * The desktop app's browser in a chat panel tab. The page itself is a native view the shell lays
 * over the host below the toolbar; this draws the chrome around it and Sim's own start and error
 * views when there is no page to show.
 */
export function BrowserSession({ scopeId, visible }: BrowserSessionProps) {
  const router = useRouter()
  const scope = useSurfaceScope()
  const browser = useBrowserPanel({
    scopeId,
    visible,
    onSettings: (query) => router.push(`${surfaceHref(scope, '/settings/browser')}${query}`),
  })
  const { page, find, snapshot } = browser
  const [query, setQuery] = useState('')
  const findInput = useRef<HTMLInputElement>(null)
  const image = snapshot && (
    <img
      ref={snapshot.ref}
      src={snapshot.src}
      alt=''
      aria-hidden
      draggable={false}
      className={styles.snapshot}
      data-placement={snapshot.viewport ? 'viewport' : 'host'}
      onError={browser.onSnapshotError}
    />
  )
  return (
    <div ref={browser.panelRef} className={styles.session}>
      <div className={styles.toolbar}>
        <IconButton
          label='Back'
          icon='I093'
          size='bar'
          disabled={!page?.canGoBack}
          onClick={browser.back}
        />
        <IconButton
          label='Forward'
          icon='I093'
          size='bar'
          mirrored
          disabled={!page?.canGoForward}
          onClick={browser.forward}
        />
        <IconButton
          label='Reload page'
          icon='I065'
          size='bar'
          disabled={!page}
          onClick={browser.reload}
        />
        <form
          key={page?.url ?? ''}
          className={styles.address}
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('address')
            if (typeof value === 'string') browser.navigate(value)
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
        >
          <Input
            label='Search Google or enter a URL'
            name='address'
            defaultValue={page?.blank ? '' : (page?.url ?? '')}
            placeholder='Search Google or enter a URL'
            spellCheck={false}
            autoComplete='off'
          />
        </form>
        <IconButton
          label='Browser menu'
          icon='I108'
          size='bar'
          onClick={(event) => browser.openMenu(event.currentTarget)}
        />
      </div>
      {find.open && (
        <div className={styles.find}>
          <FindBar
            label='Find in page'
            query={query}
            inputRef={findInput}
            onQueryChange={(next) => {
              setQuery(next)
              browser.search(next, true, true)
            }}
            results={
              find.result?.final || find.result?.matches
                ? {
                    index: Math.max(0, find.result.activeMatchOrdinal - 1),
                    count: find.result.matches,
                  }
                : undefined
            }
            onStep={(direction) => browser.search(query, direction === 1, false)}
            onClose={() => {
              setQuery('')
              browser.closeFind()
            }}
          />
        </div>
      )}
      <div ref={browser.hostRef} className={styles.host} aria-busy={page?.loading || undefined}>
        {image && (snapshot.viewport ? createPortal(image, document.body) : image)}
        {page?.blank && (
          <EmptyState title='Browse the web' description='Search or enter a URL above.' />
        )}
        {page?.issue && (
          <section className={styles.issue} aria-label={page.issue.headline}>
            <h2 data-type='T047'>{page.issue.headline}</h2>
            <p data-type='T048'>{page.issue.detail}</p>
            <div>
              <p data-type='T052'>Try:</p>
              <ul data-type='T048'>
                {page.issue.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </div>
            <p className={styles.code} data-type='T052'>
              {page.issue.code}
            </p>
            <div>
              <Button variant='muted' size='compact' icon='I065' onClick={browser.reload}>
                Reload
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
