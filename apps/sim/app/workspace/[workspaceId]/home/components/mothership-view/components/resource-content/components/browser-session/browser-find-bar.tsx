'use client'

import { type RefObject, useCallback, useEffect, useState } from 'react'
import type { BrowserFindResult } from '@sim/browser-protocol'
import { Button, ChipInput } from '@sim/emcn'
import { ArrowDown, ArrowUp, Search, X } from '@sim/emcn/icons'
import {
  findInBrowserPage,
  onBrowserFindResult,
  stopBrowserFind,
} from '@/lib/browser-agent/transport'

interface BrowserFindBarProps {
  scopeId: string
  /**
   * Owned by the panel so Mod+F can re-focus and select an already-open bar,
   * the way pressing it twice in Chrome does.
   */
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}

/**
 * Find-in-page for the embedded browser, driven by Chromium's own find — the
 * highlighting, active-match colouring, and wrap-around are the browser's, not
 * a re-implementation.
 *
 * Kept in the browser chrome beside the omnibox: a renderer element floating
 * over the native page would sit underneath its WebContentsView.
 */
export function BrowserFindBar({ inputRef, onClose, scopeId }: BrowserFindBarProps) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<BrowserFindResult | null>(null)

  useEffect(() => onBrowserFindResult(setResult, scopeId), [scopeId])

  // Stopping the find is the only thing that clears the highlights, so it has
  // to survive every unmount path — panel teardown and tab close included.
  // Focus-neutral: an unmount here is the panel going away, not a dismissal.
  useEffect(() => () => stopBrowserFind(false, scopeId), [scopeId])

  /**
   * Dismissal proper. Stops the find with focus handed back to the page before
   * unmounting, so the keystroke after Escape goes to the page the way it does
   * in Chrome. The unmount cleanup then no-ops — the find is already stopped.
   */
  const dismiss = useCallback(() => {
    stopBrowserFind(true, scopeId)
    onClose()
  }, [onClose, scopeId])

  /**
   * Typing begins a new Chromium find session and re-lights every match;
   * stepping continues that session so Chromium advances the active match
   * instead of rescanning the page from the top.
   */
  const runFind = useCallback(
    (nextQuery: string, step: 'none' | 'forward' | 'back') => {
      if (nextQuery === '') {
        setResult(null)
        stopBrowserFind(false, scopeId)
        return
      }
      findInBrowserPage(
        {
          query: nextQuery,
          newSession: step === 'none',
          forward: step !== 'back',
        },
        scopeId
      )
    },
    [scopeId]
  )

  const step = useCallback(
    (direction: 'forward' | 'back') => {
      if (query === '') return
      runFind(query, direction)
      // Clicking an arrow must not strand focus on the button — the next thing
      // typed still belongs in the query.
      inputRef.current?.focus()
    },
    [query, runFind, inputRef]
  )

  return (
    <div className='w-[clamp(170px,33%,280px)] min-w-0 shrink'>
      <ChipInput
        ref={inputRef}
        type='text'
        autoFocus
        icon={Search}
        spellCheck={false}
        autoComplete='off'
        aria-label='Find in page'
        placeholder='Find in page'
        value={query}
        inputClassName='min-w-0'
        endAdornment={
          <div className='-mr-1 flex shrink-0 items-center gap-0.5'>
            <FindCount query={query} result={result} />
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label='Previous match'
              disabled={!result?.matches}
              className='size-[24px] shrink-0 p-0'
              onClick={() => step('back')}
            >
              <ArrowUp className='size-[13px]' />
            </Button>
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label='Next match'
              disabled={!result?.matches}
              className='size-[24px] shrink-0 p-0'
              onClick={() => step('forward')}
            >
              <ArrowDown className='size-[13px]' />
            </Button>
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label='Close find bar'
              className='size-[24px] shrink-0 p-0'
              onClick={dismiss}
            >
              <X className='size-[13px]' />
            </Button>
          </div>
        }
        onChange={(event) => {
          setQuery(event.target.value)
          runFind(event.target.value, 'none')
        }}
        onKeyDown={(event) => {
          // The panel and the global command layer both listen for these.
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            dismiss()
            return
          }
          if (event.key !== 'Enter') return
          event.preventDefault()
          step(event.shiftKey ? 'back' : 'forward')
        }}
      />
    </div>
  )
}

/**
 * Chromium streams provisional counts while it is still scanning, so a zero
 * only means "not on this page" once the update is final — announcing "No
 * results" before then makes a long page look empty mid-scan.
 */
function FindCount({ query, result }: { query: string; result: BrowserFindResult | null }) {
  if (query === '' || !result) return null
  if (result.matches === 0) {
    if (!result.final) return null
    return (
      <span aria-live='polite' className='shrink-0 px-1 text-[var(--text-muted)] text-caption'>
        No results
      </span>
    )
  }
  return (
    <span
      aria-live='polite'
      className='shrink-0 px-1 text-[var(--text-muted)] text-caption tabular-nums'
    >
      {result.activeMatchOrdinal}/{result.matches}
    </span>
  )
}
