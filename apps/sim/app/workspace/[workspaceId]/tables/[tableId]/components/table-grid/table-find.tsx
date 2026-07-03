'use client'

import type React from 'react'
import { Button, ChipInput } from '@sim/emcn'
import { Loader, X } from '@sim/emcn/icons'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface TableFindProps {
  query: string
  onQueryChange: (query: string) => void
  /** Run the search (dirty Enter / search button). */
  onSubmit: () => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /** Number of matches after dropping columns not in the current view. */
  count: number
  /** 0-based index of the active match, or -1 when there are none. */
  currentIndex: number
  /** Whether the server capped the match set. */
  truncated: boolean
  isLoading: boolean
  /** Whether the input differs from the last submitted term. */
  isDirty: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function TableFind({
  query,
  onQueryChange,
  onSubmit,
  onNext,
  onPrev,
  onClose,
  count,
  currentIndex,
  truncated,
  isLoading,
  isDirty,
  inputRef,
}: TableFindProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        onPrev()
      } else if (isDirty) {
        onSubmit()
      } else {
        onNext()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const hasMatches = count > 0
  const label =
    count === 0 ? 'No results' : `${currentIndex + 1} of ${count}${truncated ? '+' : ''}`

  return (
    <div className='absolute top-2 right-2 z-[20] flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-medium'>
      <ChipInput
        ref={inputRef}
        value={query}
        placeholder='Search'
        className='w-[200px]'
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className='flex min-w-[64px] shrink-0 items-center justify-end whitespace-nowrap px-1 text-[var(--text-muted)] text-xs tabular-nums'>
        {isLoading ? <Loader className='size-[12px] animate-spin' /> : label}
      </span>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Previous match'
        title='Previous match (Shift+Enter)'
        disabled={!hasMatches}
        onClick={onPrev}
      >
        <ChevronUp className='size-[14px] text-[var(--text-icon)]' />
      </Button>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Next match'
        title='Next match (Enter)'
        disabled={!hasMatches}
        onClick={onNext}
      >
        <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
      </Button>
      <Button
        variant='ghost'
        className='size-8 shrink-0 p-0'
        aria-label='Close find'
        title='Close (Esc)'
        onClick={onClose}
      >
        <X className='size-[14px] text-[var(--text-icon)]' />
      </Button>
    </div>
  )
}
