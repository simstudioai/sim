'use client'

import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useFindShortcut } from '@/app/workspace/[workspaceId]/components'
import { ACTIVE_MATCH_CLASS, getFindTally, setFindQuery, stepFindMatch } from './find-extension'

/** What the surface hands `FindBar`, plus the open state the shortcut drives. */
export interface MarkdownFindController {
  isOpen: boolean
  query: string
  count: number
  currentIndex: number
  truncated: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  setQuery: (query: string) => void
  next: () => void
  prev: () => void
  close: () => void
}

/** The only three values the bar renders, mirrored out of the plugin. */
interface FindTally {
  count: number
  currentIndex: number
  truncated: boolean
}

const EMPTY_TALLY: FindTally = { count: 0, currentIndex: 0, truncated: false }

interface UseMarkdownFindOptions {
  editor: Editor | null
  /**
   * Whether this editor claims Cmd/Ctrl+F. Off wherever the component renders inside a preview or
   * embedded pane, where the surface around it — not the document — owns the shortcut. See
   * {@link useFindShortcut} for how the surfaces arbitrate.
   */
  enabled: boolean
}

/**
 * Find-in-document for the rich markdown editor: owns the term, the tally and the stepping that
 * `FindBar` renders, and reveals each match as it becomes active.
 *
 * The match set itself lives in the ProseMirror plugin (`./find-extension`), which re-searches on
 * every document change. This subscribes to the editor's transactions while the bar is open and
 * mirrors only the three numbers the bar shows, so a keystroke that leaves the tally identical
 * re-renders nothing — the editor is configured not to re-render React on transactions, and this
 * must not undo that.
 */
export function useMarkdownFind({
  editor,
  enabled,
}: UseMarkdownFindOptions): MarkdownFindController {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [tally, setTally] = useState<FindTally>(EMPTY_TALLY)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor

  /**
   * Scrolls the active highlight into view. Read from the DOM rather than mapped from the position
   * so it lands on what is actually painted — a match inside a node view (a code block, a table
   * cell) is rendered by that view, and its own scroll container is the one that has to move.
   */
  const revealActiveMatch = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.view.dom
        .querySelector(`.${ACTIVE_MATCH_CLASS}`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [])

  /**
   * The single point where plugin state becomes React state. Driven by the editor's own
   * `transaction` event, which TipTap emits synchronously from every dispatch — including the ones
   * `setQuery` and `step` make below, so neither needs to sync by hand.
   */
  const syncTally = useCallback(() => {
    const current = editorRef.current
    if (!current) return
    const { matches, activeIndex, truncated } = getFindTally(current.state)
    setTally((previous) =>
      previous.count === matches.length &&
      previous.currentIndex === activeIndex &&
      previous.truncated === truncated
        ? previous
        : { count: matches.length, currentIndex: activeIndex, truncated }
    )
  }, [])

  /**
   * Keeps the tally honest while the bar is open — the document can change underneath a live search
   * from the user's own typing, a collaborator, or a streaming agent edit, and the plugin re-searches
   * on each of those. Not subscribed while the bar is closed, so typing costs nothing then.
   */
  useEffect(() => {
    if (!editor || !isOpen) return
    syncTally()
    editor.on('transaction', syncTally)
    return () => {
      editor.off('transaction', syncTally)
    }
  }, [editor, isOpen, syncTally])

  /**
   * Re-applies the live term to a newly arrived editor. `useEditor` returns null on the first render,
   * so a term typed into the bar before the editor mounts would be held in React and never searched,
   * leaving the bar at "No results" until the next keystroke pushed it through.
   */
  const queryRef = useRef(query)
  queryRef.current = query
  useEffect(() => {
    if (!editor || queryRef.current.length === 0) return
    setFindQuery(editor, queryRef.current)
  }, [editor])

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      const current = editorRef.current
      if (!current) return
      setFindQuery(current, next)
      revealActiveMatch()
    },
    [revealActiveMatch]
  )

  const step = useCallback(
    (delta: number) => {
      const current = editorRef.current
      if (!current) return
      stepFindMatch(current, delta)
      revealActiveMatch()
    },
    [revealActiveMatch]
  )

  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  /** Closing ends the search: term, highlights and active match all go. */
  const close = useCallback(() => {
    setIsOpen(false)
    setQueryState('')
    setTally(EMPTY_TALLY)
    const current = editorRef.current
    if (current) setFindQuery(current, '')
  }, [])

  const open = useCallback(() => setIsOpen(true), [])
  useFindShortcut({ enabled, inputRef, onOpen: open })

  return {
    isOpen,
    query,
    count: tally.count,
    currentIndex: tally.currentIndex,
    truncated: tally.truncated,
    inputRef,
    setQuery,
    next,
    prev,
    close,
  }
}
