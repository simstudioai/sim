'use client'

import { type KeyboardEvent, memo, type RefObject } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'

interface FindBarProps {
  query: string
  onQueryChange: (query: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /** Adopts the typed term at once instead of waiting out the debounce. */
  onSubmit: () => void
  /** The typed term is not the one the results describe yet. */
  isStale: boolean
  /** The results on screen belong to the submitted term, so stepping through them is meaningful. */
  canNavigate: boolean
  count: number
  currentIndex: number
  /** The server stopped counting; more matches exist than `count`. */
  truncated: boolean
  inputRef: RefObject<HTMLInputElement | null>
}

/**
 * Cmd/Ctrl+F find over the whole table, searched on the server as the reader types: a counter,
 * previous and next, and close. Enter commits an unsearched term or steps to the next match,
 * Shift+Enter to the previous one, and Escape closes.
 */
export const FindBar = memo(function FindBar({
  query,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
  onSubmit,
  isStale,
  canNavigate,
  count,
  currentIndex,
  truncated,
  inputRef,
}: FindBarProps) {
  const hasQuery = query.trim().length > 0
  const hasMatches = count > 0
  const navEnabled = hasMatches && canNavigate

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    // Commit an unsearched term; otherwise step, but only once the results describe the term.
    if (isStale) onSubmit()
    else if (!canNavigate) return
    else if (event.shiftKey) onPrev()
    else onNext()
  }

  return (
    <div
      className={styles.findBar}
      data-material='floating'
      data-elevation='menu'
      onKeyDown={handleKeyDown}
    >
      <span className={styles.findInput}>
        <Input
          label='Find in table'
          placeholder='Search'
          value={query}
          onChange={onQueryChange}
          spellCheck={false}
          autoComplete='off'
          inputRef={inputRef}
          trailing={
            query.length > 0 ? (
              <IconButton
                label='Clear search'
                icon='I105'
                onClick={() => {
                  onQueryChange('')
                  inputRef.current?.focus()
                }}
              />
            ) : undefined
          }
        />
      </span>
      {/* Always mounted, keeping its width, so the bar never resizes on the first keystroke and
          the live region exists before its text arrives. */}
      <span className={styles.findCount} aria-live='polite' data-type='T052'>
        {hasQuery && !isStale && (hasMatches || canNavigate)
          ? hasMatches
            ? `${currentIndex + 1} of ${count}${truncated ? '+' : ''}`
            : 'No results'
          : null}
      </span>
      <IconButton label='Previous match' icon='I023' disabled={!navEnabled} onClick={onPrev} />
      <IconButton label='Next match' icon='I102' disabled={!navEnabled} onClick={onNext} />
      <IconButton label='Close find' icon='I105' onClick={onClose} />
    </div>
  )
})
