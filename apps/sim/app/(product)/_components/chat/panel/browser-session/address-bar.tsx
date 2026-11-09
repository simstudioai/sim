'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Input } from '@sim/emcn/field/inputs'
import { Icon } from '@sim/emcn/icon'
import styles from '@/app/(product)/_components/chat/panel/browser-session/browser-session.module.css'
import {
  FieldPopover,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/_components/field-popover/field-popover'
import type { useBrowserPanel } from '@/platform/lib/data/browser-panel'
import {
  type OmniboxSuggestion,
  type UrlSuggestion,
  useBrowserOmnibox,
} from '@/platform/lib/data/browser-suggestions'

type BrowserPanel = ReturnType<typeof useBrowserPanel>

/** A browser-imported icon stays local; a host without one shows a link glyph. */
function SuggestionIcon({ suggestion }: { suggestion: UrlSuggestion }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const icon = suggestion.icon
  if (!icon || failedIcon === icon) return <Icon name='link' />
  return <img src={icon} alt='' className={styles.favicon} onError={() => setFailedIcon(icon)} />
}

function SuggestionLabel({ suggestion }: { suggestion: OmniboxSuggestion }) {
  if (suggestion.kind === 'search') return suggestion.query
  if (!suggestion.name) return suggestion.hostname
  return (
    <>
      {suggestion.name} <span className={styles.suggestionHost}>— {suggestion.hostname}</span>
    </>
  )
}

interface AddressBarProps {
  browser: BrowserPanel
}

/**
 * The browser's address bar with the legacy omnibox list: hosts this browser knows and Google
 * completions, opened only once the native page has been swapped for its captured frame.
 */
export function AddressBar({ browser }: AddressBarProps) {
  const { page } = browser
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const omnibox = useBrowserOmnibox({
    pageUrl: page?.blank ? '' : (page?.url ?? ''),
    panelVisible: browser.panelVisible,
    rendererPage: browser.rendererPage,
    blocked: browser.blocked,
    overlay: browser.suggestionsOverlay,
    inputRef,
    onNavigate: browser.navigateTo,
  })
  const { open, activeIndex } = omnibox
  useActiveRowIntoView(open, activeIndex ?? -1)

  // The shared field takes no combobox props, so its input is named as one here.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', String(open))
  }, [open])

  return (
    <form
      className={styles.address}
      onSubmit={(event) => {
        event.preventDefault()
        omnibox.submit()
      }}
    >
      <div
        ref={fieldRef}
        onKeyDown={omnibox.onKeyDown}
        onPointerDown={omnibox.onPointerDown}
        onPointerMove={omnibox.onPointerMove}
        onPointerUp={omnibox.onPointerUp}
        onPointerCancel={omnibox.onPointerUp}
      >
        <Input
          label='Search Google or enter a URL'
          name='address'
          inputRef={inputRef}
          value={omnibox.value}
          onChange={omnibox.onChange}
          onFocus={(event) => omnibox.onFocus(event.currentTarget)}
          onBlur={(event) => omnibox.onBlur(event.currentTarget)}
          placeholder='Search Google or enter a URL'
          spellCheck={false}
          autoComplete='off'
        />
      </div>
      <FieldPopover
        label='Suggestions'
        open={open}
        anchor={fieldRef}
        matchAnchorWidth
        onDismiss={omnibox.dismiss}
      >
        {omnibox.suggestions.map((suggestion, index) => (
          <FieldPopoverRow
            key={
              suggestion.kind === 'site'
                ? `site:${suggestion.hostname}`
                : `search:${suggestion.query}`
            }
            index={index}
            active={index === activeIndex}
            leading={
              suggestion.kind === 'search' ? (
                <Icon name='I089' />
              ) : (
                <SuggestionIcon suggestion={suggestion} />
              )
            }
            onHover={() => omnibox.hover(index)}
            onSelect={() => omnibox.choose(suggestion)}
          >
            <SuggestionLabel suggestion={suggestion} />
          </FieldPopoverRow>
        ))}
      </FieldPopover>
    </form>
  )
}
