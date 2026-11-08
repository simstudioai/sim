'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { MenuSearchField } from '@sim/emcn/search-field/menu-search-field'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/find-bar.module.css'
import type { MarkdownFindController } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/use-markdown-find'

interface FindBarProps {
  find: MarkdownFindController
  /** Replace is offered only while the document is editable. */
  canReplace: boolean
}

function isComposing(event: React.KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/**
 * Find and replace in the document, floating at the editor's top end as an in-page find does:
 * Enter steps forward, Shift+Enter back, Escape closes.
 */
export function FindBar({ find, canReplace }: FindBarProps) {
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [showReplace, setShowReplace] = useState(false)
  const hasQuery = find.query.trim().length > 0
  const hasMatches = find.count > 0
  const tally = !hasQuery
    ? ''
    : hasMatches
      ? `${find.currentIndex + 1} of ${find.count}${find.truncated ? '+' : ''}`
      : 'No results'

  return (
    <div
      className={styles.bar}
      data-material='floating'
      data-elevation='menu'
      data-replace={canReplace || undefined}
      role='search'
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || isComposing(event)) return
        event.stopPropagation()
        event.preventDefault()
        find.close()
      }}
    >
      <div className={styles.row}>
        {canReplace && (
          <IconButton
            label={showReplace ? 'Hide replace' : 'Show replace'}
            icon={showReplace ? 'I051' : 'I032'}
            size='compact'
            onClick={() => setShowReplace((visible) => !visible)}
          />
        )}
        <span className={styles.field}>
          <MenuSearchField
            input={
              <input
                ref={find.inputRef}
                type='search'
                value={find.query}
                placeholder='Find'
                aria-label='Find in document'
                spellCheck={false}
                autoComplete='off'
                onChange={(event) => find.setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || isComposing(event)) return
                  event.preventDefault()
                  if (event.shiftKey) find.prev()
                  else find.next()
                }}
              />
            }
          />
        </span>
        <span className={styles.tally} data-type='T052' aria-live='polite'>
          {tally}
        </span>
        <IconButton
          label='Previous match'
          icon='I023'
          size='compact'
          disabled={!hasMatches}
          onClick={find.prev}
        />
        <IconButton
          label='Next match'
          icon='I102'
          size='compact'
          disabled={!hasMatches}
          onClick={find.next}
        />
        <IconButton label='Close find' icon='I105' size='compact' onClick={find.close} />
      </div>
      {canReplace && showReplace && (
        <div className={styles.row}>
          <span className={styles.indent} aria-hidden='true' />
          <span className={styles.field}>
            <MenuSearchField
              input={
                <input
                  ref={replaceInputRef}
                  type='search'
                  value={find.replacement}
                  placeholder='Replace'
                  aria-label='Replace in document'
                  spellCheck={false}
                  autoComplete='off'
                  onChange={(event) => find.setReplacement(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || isComposing(event) || !hasMatches) return
                    event.preventDefault()
                    find.replaceCurrent()
                  }}
                />
              }
            />
          </span>
          <Button
            variant='quiet'
            size='compact'
            disabled={!hasMatches}
            onClick={() => {
              find.replaceCurrent()
              replaceInputRef.current?.focus()
            }}
          >
            Replace
          </Button>
          <Button
            variant='quiet'
            size='compact'
            aria-label='Replace all matches'
            disabled={!hasMatches || find.truncated}
            disabledReason={find.truncated ? 'Narrow the search to replace all' : undefined}
            onClick={() => {
              find.replaceAll()
              replaceInputRef.current?.focus()
            }}
          >
            All
          </Button>
        </div>
      )}
    </div>
  )
}
