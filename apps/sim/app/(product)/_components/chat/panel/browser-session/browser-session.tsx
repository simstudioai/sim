'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Input } from '@sim/emcn/field/inputs'
import { FindBar } from '@sim/emcn/find-bar'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { AddressBar } from '@/app/(product)/_components/chat/panel/browser-session/address-bar'
import styles from '@/app/(product)/_components/chat/panel/browser-session/browser-session.module.css'
import {
  ContinueSignInNotice,
  continueSignInActions,
} from '@/app/(product)/_components/chat/panel/browser-session/continue-sign-in'
import { DownloadsMenu } from '@/app/(product)/_components/chat/panel/browser-session/downloads-menu'
import {
  AppLaunchNotice,
  PageDialogModal,
  PagePromptModal,
  PermissionModal,
} from '@/app/(product)/_components/chat/panel/browser-session/page-prompts'
import { useBrowserPanel } from '@/platform/lib/data/browser-panel'
import { useContinueSignIn } from '@/platform/lib/data/browser-sign-in'
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
  const { page, find, snapshot, menu } = browser
  const signIn = useContinueSignIn(scopeId, page?.url)
  const [query, setQuery] = useState('')
  const findInput = useRef<HTMLInputElement>(null)
  const menuAnchor = useRef<HTMLSpanElement>(null)
  const menuActions = (): MenuAction[] => [
    {
      id: 'find',
      label: 'Find in Page',
      shortcut: '⌘F',
      onSelect: menu.afterClose(browser.openFind),
    },
    ...continueSignInActions(signIn, menu.afterClose),
    {
      id: 'zoom-in',
      label: 'Zoom In',
      shortcut: '⌘+',
      separatorBefore: true,
      onSelect: menu.afterClose(() => menu.zoom('zoom-in')),
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      shortcut: '⌘−',
      onSelect: menu.afterClose(() => menu.zoom('zoom-out')),
    },
    {
      id: 'zoom-reset',
      label: 'Actual Size',
      shortcut: '⌘0',
      onSelect: menu.afterClose(() => menu.zoom('zoom-reset')),
    },
    {
      id: 'fill-password',
      label: 'Fill Saved Password',
      separatorBefore: true,
      disabled: !menu.fillAvailable,
      onSelect: menu.afterClose(() => menu.fillPassword(menuAnchor.current)),
    },
    {
      id: 'passwords',
      label: 'Passwords',
      onSelect: menu.afterClose(() => menu.settings('?browserView=passwords')),
    },
    {
      id: 'import-passwords',
      label: 'Import Passwords',
      disabled: !menu.canImport,
      onSelect: menu.afterClose(() => menu.settings('?browserImport=1')),
    },
    {
      id: 'browser-settings',
      label: 'Browser Settings',
      separatorBefore: true,
      onSelect: menu.afterClose(() => menu.settings('')),
    },
  ]
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
        <AddressBar browser={browser} />
        {browser.downloads && <DownloadsMenu downloads={browser.downloads} />}
        <span ref={menuAnchor} className={styles.menu}>
          <ActionMenu
            label='Browser menu'
            icon='I108'
            triggerSize='bar'
            align='end'
            open={menu.open}
            onOpenChange={(open) => menu.onOpenChange(open, menuAnchor.current)}
            actions={menuActions}
          />
        </span>
      </div>
      {(signIn.pending || signIn.hintVisible) && (
        <div className={styles.notice}>
          <ContinueSignInNotice signIn={signIn} />
        </div>
      )}
      {browser.launchNotice && (
        <div className={styles.notice}>
          <AppLaunchNotice
            key={browser.launchNotice.requestId}
            notice={browser.launchNotice}
            onRespond={browser.respondPrompt}
          />
        </div>
      )}
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
      {browser.permission && (
        <PermissionModal key={browser.permission.requestId} permission={browser.permission} />
      )}
      {browser.dialog && (
        <PageDialogModal
          key={browser.dialog.requestId}
          dialog={browser.dialog}
          onAnswer={browser.answerDialog}
        />
      )}
      {browser.prompt && (
        <PagePromptModal prompt={browser.prompt} onRespond={browser.respondPrompt} />
      )}
    </div>
  )
}
