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
 * Docked above the page rather than floating over it like Chrome's: a renderer
 * element overlapping the native view trips the occlusion path, which hides
 * the view and would blank the page being searched.
 */
export function BrowserFindBar({ inputRef, onClose }: BrowserFindBarProps) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<BrowserFindResult | null>(null)

  useEffect(() => onBrowserFindResult(setResult), [])

  // Stopping the find is the only thing that clears the highlights, so it has
  // to survive every unmount path — panel teardown and tab close included.
  // Focus-neutral: an unmount here is the panel going away, not a dismissal.
  useEffect(() => () => stopBrowserFind(), [])

  /**
   * Dismissal proper. Stops the find with focus handed back to the page before
   * unmounting, so the keystroke after Escape goes to the page the way it does
   * in Chrome. The unmount cleanup then no-ops — the find is already stopped.
   */
  const dismiss = useCallback(() => {
    stopBrowserFind(true)
    onClose()
  }, [onClose])

  /**
   * `findNext: false` restarts the search and re-lights every match, which is
   * what each keystroke means; stepping passes true so Chromium advances the
   * active match instead of starting over at the top.
   */
  const runFind = useCallback((nextQuery: string, step: 'none' | 'forward' | 'back') => {
    if (nextQuery === '') {
      setResult(null)
      stopBrowserFind()
      return
    }
    findInBrowserPage({
      query: nextQuery,
      findNext: step !== 'none',
      forward: step !== 'back',
    })
  }, [])

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
    <div className='flex items-center gap-1 border-[var(--border)] border-t px-2.5 py-1.5'>
      <ChipInput
        ref={inputRef}
        type='text'
        icon={Search}
        spellCheck={false}
        autoComplete='off'
        aria-label='Find in page'
        placeholder='Find in page'
        value={query}
        className='min-w-0 flex-1'
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
      <FindCount query={query} result={result} />
      <Button
        type='button'
        variant='ghost-secondary'
        size='sm'
        aria-label='Previous match'
        disabled={!result?.matches}
        className='size-[30px] flex-shrink-0 p-0'
        onClick={() => step('back')}
      >
        <ArrowUp className='size-[14px]' />
      </Button>
      <Button
        type='button'
        variant='ghost-secondary'
        size='sm'
        aria-label='Next match'
        disabled={!result?.matches}
        className='size-[30px] flex-shrink-0 p-0'
        onClick={() => step('forward')}
      >
        <ArrowDown className='size-[14px]' />
      </Button>
      <Button
        type='button'
        variant='ghost-secondary'
        size='sm'
        aria-label='Close find bar'
        className='size-[30px] flex-shrink-0 p-0'
        onClick={dismiss}
      >
        <X className='size-[14px]' />
      </Button>
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
      <span aria-live='polite' className='flex-shrink-0 px-1 text-[var(--text-muted)] text-caption'>
        No results
      </span>
    )
  }
  return (
    <span
      aria-live='polite'
      className='flex-shrink-0 px-1 text-[var(--text-muted)] text-caption tabular-nums'
    >
      {result.activeMatchOrdinal}/{result.matches}
    </span>
  )
}
