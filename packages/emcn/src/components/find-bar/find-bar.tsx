'use client'

import { type KeyboardEvent, memo, type RefObject, useRef, useState } from 'react'
import { Button, IconButton } from '#emcn/components/button/button'
import { Input } from '#emcn/components/field/inputs'
import styles from '#emcn/components/find-bar/find-bar.module.css'

/** Replacing matches, offered only where the content is editable. */
interface FindReplace {
  value: string
  onChange: (value: string) => void
  onReplace: () => void
  onReplaceAll: () => void
  /** Why Replace all is unavailable, as when the match count is truncated. */
  replaceAllDisabledReason?: string
}

interface FindBarProps {
  /** Names the search and its field, e.g. "Find in table". */
  label: string
  query: string
  onQueryChange: (query: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  /** The current match and the total; absent while no search describes the typed term. */
  results?: { index: number; count: number; truncated?: boolean }
  /** Stepping is meaningful only once results describe the typed term; defaults to having matches. */
  canStep?: boolean
  onStep: (direction: 1 | -1) => void
  onClose: () => void
  /** The typed term is not searched yet: Enter searches it at once through `onCommit`. */
  pending?: boolean
  onCommit?: () => void
  replace?: FindReplace
}

function isComposing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/**
 * An in-page find: the term, the match tally, previous, next and close, with replace beneath when
 * the content is editable. Enter searches a pending term or steps forward, Shift+Enter steps back
 * and Escape closes. Its consumer places it over the content it searches.
 */
export const FindBar = memo(function FindBar({
  label,
  query,
  onQueryChange,
  inputRef,
  results,
  canStep,
  onStep,
  onClose,
  pending = false,
  onCommit,
  replace,
}: FindBarProps) {
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [showReplace, setShowReplace] = useState(false)
  const hasMatches = (results?.count ?? 0) > 0
  const steppable = canStep ?? hasMatches
  const tally =
    !query.trim() || !results
      ? null
      : hasMatches
        ? `${results.index + 1} of ${results.count}${results.truncated ? '+' : ''}`
        : 'No results'

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(event)) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    // The bar owns Enter as it owns Escape, so a host listening for Enter does not act on it again.
    event.stopPropagation()
    event.preventDefault()
    if (event.target === replaceInputRef.current) {
      if (hasMatches) replace?.onReplace()
      return
    }
    if (pending && onCommit) onCommit()
    else if (steppable) onStep(event.shiftKey ? -1 : 1)
  }

  return (
    <div
      className={styles.bar}
      role='search'
      aria-label={label}
      data-material='floating'
      data-elevation='menu'
      data-replace={replace ? '' : undefined}
      onKeyDown={onKeyDown}
    >
      <div className={styles.row}>
        {replace && (
          <IconButton
            label={showReplace ? 'Hide replace' : 'Show replace'}
            icon={showReplace ? 'I051' : 'I032'}
            size='compact'
            onClick={() => setShowReplace((visible) => !visible)}
          />
        )}
        <span className={styles.field}>
          <Input
            label={label}
            placeholder='Find'
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
                  size='compact'
                  onClick={() => {
                    onQueryChange('')
                    inputRef.current?.focus()
                  }}
                />
              ) : undefined
            }
          />
        </span>
        {/* Always mounted at its width, so the bar keeps its size and the live region exists before its text. */}
        <span className={styles.tally} data-type='T052' aria-live='polite'>
          {tally}
        </span>
        <IconButton
          label='Previous match'
          icon='I023'
          size='compact'
          disabled={!steppable}
          onClick={() => onStep(-1)}
        />
        <IconButton
          label='Next match'
          icon='I102'
          size='compact'
          disabled={!steppable}
          onClick={() => onStep(1)}
        />
        <IconButton label='Close find' icon='I105' size='compact' onClick={onClose} />
      </div>
      {replace && showReplace && (
        <div className={styles.row}>
          <span className={styles.indent} aria-hidden='true' />
          <span className={styles.field}>
            <Input
              label='Replace with'
              placeholder='Replace'
              value={replace.value}
              onChange={replace.onChange}
              spellCheck={false}
              autoComplete='off'
              inputRef={replaceInputRef}
            />
          </span>
          <Button
            variant='quiet'
            size='compact'
            disabled={!hasMatches}
            onClick={() => {
              replace.onReplace()
              replaceInputRef.current?.focus()
            }}
          >
            Replace
          </Button>
          <Button
            variant='quiet'
            size='compact'
            aria-label='Replace all matches'
            disabled={!hasMatches || Boolean(replace.replaceAllDisabledReason)}
            disabledReason={replace.replaceAllDisabledReason}
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
