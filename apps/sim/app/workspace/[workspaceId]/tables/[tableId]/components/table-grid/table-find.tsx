'use client'

import type React from 'react'
import { Button, Input } from '@/components/emcn'
import { ArrowDown, ArrowUp, Loader, Search, X } from '@/components/emcn/icons'

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

  return (
    <div className='absolute top-2 right-2 z-[20] flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] py-1 pr-1 pl-2 shadow-medium'>
      <Search className='size-[14px] shrink-0 text-[var(--text-icon)]' />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='Find in table'
        className='h-[24px] w-[180px] border-none bg-transparent px-0 text-small shadow-none focus-visible:ring-0'
      />
      <span className='min-w-[44px] shrink-0 text-right text-[var(--text-tertiary)] text-xs tabular-nums'>
        {isLoading ? (
          <Loader className='ml-auto size-[12px] animate-spin' />
        ) : (
          `${hasMatches ? currentIndex + 1 : 0}/${count}${truncated ? '+' : ''}`
        )}
      </span>
      <div className='flex items-center'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-label='Previous match'
          title='Previous match (Shift+Enter)'
          disabled={!hasMatches}
          className='size-[24px] shrink-0 p-0'
          onClick={onPrev}
        >
          <ArrowUp className='size-[14px]' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-label='Next match'
          title='Next match (Enter)'
          disabled={!hasMatches}
          className='size-[24px] shrink-0 p-0'
          onClick={onNext}
        >
          <ArrowDown className='size-[14px]' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-label='Close find'
          title='Close (Esc)'
          className='size-[24px] shrink-0 p-0'
          onClick={onClose}
        >
          <X className='size-[14px]' />
        </Button>
      </div>
    </div>
  )
}
