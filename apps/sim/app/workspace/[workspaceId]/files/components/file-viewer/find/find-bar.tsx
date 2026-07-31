'use client'

import { useEffect, useRef } from 'react'
import { Button, ChipInput } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useFileFind } from './find-context'

/**
 * The file-viewer find bar. Find-only (no replace) with live matching, modeled on the Tables module's
 * find ({@link TableFind}): input, `N of M` count, up/down, close. Rendered top-right of the viewer by
 * {@link FileFindProvider}; drives the active surface through {@link useFileFind}. Searches as you type,
 * so Enter/Shift+Enter only step between matches.
 */
export function FileFindBar() {
  const { query, result, close, setQuery, next, prev } = useFileFind()

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const hasMatches = result.count > 0
  const label =
    result.count === 0
      ? query
        ? 'No results'
        : ''
      : `${result.currentIndex + 1} of ${result.count}${result.truncated ? '+' : ''}`

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) prev()
      else next()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className='absolute top-2 right-2 z-[20] flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-medium'>
      <ChipInput
        ref={inputRef}
        value={query}
        placeholder='Find'
        className='w-[200px]'
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className='flex min-w-[64px] shrink-0 items-center justify-end whitespace-nowrap px-1 text-[var(--text-muted)] text-xs tabular-nums'>
        {label}
      </span>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Previous match'
        title='Previous match (⇧⏎)'
        disabled={!hasMatches}
        onClick={prev}
      >
        <ChevronUp className='size-[14px] text-[var(--text-icon)]' />
      </Button>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Next match'
        title='Next match (⏎)'
        disabled={!hasMatches}
        onClick={next}
      >
        <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
      </Button>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Close find'
        title='Close (Esc)'
        onClick={close}
      >
        <X className='size-[14px] text-[var(--text-icon)]' />
      </Button>
    </div>
  )
}
