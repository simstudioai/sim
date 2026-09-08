'use client'

import type React from 'react'
import { memo, useRef, useState } from 'react'
import { Button, ChipInput, cn } from '@sim/emcn'
import { ChevronDown, ChevronRight, ChevronUp, Loader, Search, X } from '@sim/emcn/icons'

export interface FindReplaceControls {
  value: string
  onChange: (value: string) => void
  onReplace: () => void
  onReplaceAll: () => void
  canReplace: boolean
  canReplaceAll: boolean
}

export interface FindBarProps {
  /** Accessible name for the input, naming the surface: "Find in table", "Find in files". */
  ariaLabel: string
  query: string
  onQueryChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /**
   * Adopts the typed term immediately, skipping the surface's debounce. Only
   * meaningful on a surface that debounces; omit it and Enter always steps.
   */
  onSubmit?: () => void
  /**
   * Whether the typed term has yet to be searched, so Enter should commit it
   * rather than step. Defaults to false — a surface that searches
   * synchronously is never stale.
   */
  isStale?: boolean
  /**
   * Whether the matches on screen belong to the term that was searched. False
   * while a term's own results are in flight, when the count still describes
   * the previous term and stepping through it would land on a cell the box no
   * longer names. Defaults to true for surfaces that match synchronously.
   */
  canNavigate?: boolean
  /** Number of matches after dropping any the current view cannot show. */
  count: number
  /** 0-based index of the active match. Ignored when `count` is 0. */
  currentIndex: number
  /** Whether the producer capped the match set. */
  truncated: boolean
  isLoading: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  replace?: FindReplaceControls
}

/**
 * The find bar every Cmd/Ctrl+F surface shares (tables, files, ...). Purely
 * presentational and fully controlled: the surface owns the query, the match
 * model and the stepping; this renders the input, the tally and the
 * next/prev/close controls. Positioned absolutely against the nearest
 * relative container, top-right, the way an in-page find sits in Chrome.
 *
 * Memoized: while the bar is open it is a child of a view that re-renders on
 * scroll, hover and selection. Every prop is a primitive or a stable
 * identity, so this collapses to renders where a find value actually changed.
 */
export const FindBar = memo(function FindBar({
  ariaLabel,
  query,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
  onSubmit,
  isStale = false,
  canNavigate = true,
  count,
  currentIndex,
  truncated,
  isLoading,
  inputRef,
  replace,
}: FindBarProps) {
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [showReplace, setShowReplace] = useState(false)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault()
      // Commit an unsearched term; otherwise step — but only once the results
      // describe it. In between (committed, still loading) Enter does nothing
      // rather than walk the previous term's matches; the surface's auto-reveal
      // lands on the first hit as soon as they arrive.
      if (isStale && onSubmit) onSubmit()
      else if (!canNavigate) return
      else if (e.shiftKey) onPrev()
      else onNext()
      return
    }
  }

  const hasQuery = query.trim().length > 0
  const hasMatches = count > 0
  const navEnabled = hasMatches && canNavigate

  /** The tally holds its last value while the next result set loads — blanking
   *  it on every keystroke reads as the feature breaking rather than working. */
  function counterContent() {
    if (!hasQuery) return null
    if (hasMatches) return `${currentIndex + 1} of ${count}${truncated ? '+' : ''}`
    return isLoading ? <Loader aria-hidden className='size-[13px] animate-spin' /> : 'No results'
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        event.preventDefault()
        onClose()
      }}
      className={cn(
        'absolute top-2 right-2 z-[var(--z-dropdown)] flex max-w-[calc(100%_-_1rem)] flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1 shadow-medium',
        replace && 'w-[min(400px,calc(100%_-_1rem))]'
      )}
    >
      <div className='flex items-center gap-1.5'>
        {replace && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-6 shrink-0'
            aria-label={showReplace ? 'Hide replace' : 'Show replace'}
            aria-expanded={showReplace}
            onClick={() => setShowReplace((visible) => !visible)}
          >
            <ChevronRight className={showReplace ? 'size-[13px] rotate-90' : 'size-[13px]'} />
          </Button>
        )}
        <ChipInput
          ref={inputRef}
          value={query}
          placeholder='Search'
          aria-label={ariaLabel}
          spellCheck={false}
          autoComplete='off'
          icon={Search}
          className={replace ? 'min-w-0 flex-1' : 'w-[200px]'}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          endAdornment={
            query.length > 0 ? (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='-mr-1 shrink-0'
                aria-label='Clear search'
                onClick={() => {
                  onQueryChange('')
                  inputRef.current?.focus()
                }}
              >
                <X className='size-[13px]' />
              </Button>
            ) : undefined
          }
        />
        {/* Always mounted, reserving its width: rendering it only once there is a
          query would resize the bar on the first keystroke, and a live region
          inserted together with its text is announced unreliably. */}
        <span
          aria-live='polite'
          className='flex min-w-[64px] shrink-0 items-center justify-end whitespace-nowrap px-1 text-[var(--text-muted)] text-caption tabular-nums'
        >
          {counterContent()}
        </span>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-6 shrink-0'
          aria-label='Previous match'
          title='Previous match (Shift+Enter)'
          disabled={!navEnabled}
          onClick={onPrev}
        >
          <ChevronUp className='size-[13px]' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-6 shrink-0'
          aria-label='Next match'
          title='Next match (Enter)'
          disabled={!navEnabled}
          onClick={onNext}
        >
          <ChevronDown className='size-[13px]' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-6 shrink-0'
          aria-label='Close find'
          title='Close (Esc)'
          onClick={onClose}
        >
          <X className='size-[13px]' />
        </Button>
      </div>
      {replace && showReplace && (
        <div className='flex items-center gap-1.5'>
          <span aria-hidden className='w-6 shrink-0' />
          <ChipInput
            ref={replaceInputRef}
            value={replace.value}
            placeholder='Replace'
            aria-label='Replace in document'
            spellCheck={false}
            autoComplete='off'
            className='min-w-0 flex-1'
            onChange={(event) => replace.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && replace.canReplace) {
                event.preventDefault()
                replace.onReplace()
              }
            }}
          />
          <Button
            type='button'
            variant='quiet'
            size='sm'
            disabled={!replace.canReplace}
            onClick={() => {
              replace.onReplace()
              replaceInputRef.current?.focus()
            }}
          >
            Replace
          </Button>
          <Button
            type='button'
            variant='quiet'
            size='sm'
            title={
              !replace.canReplaceAll && truncated ? 'Narrow the search to replace all' : undefined
            }
            disabled={!replace.canReplaceAll}
            aria-label='Replace all matches'
            onClick={() => {
              replace.onReplaceAll()
              replaceInputRef.current?.focus()
            }}
          >
            All
          </Button>
        </div>
      )}
    </div>
  )
})
