'use client'

import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  getFindTally,
  replaceActiveFindMatch,
  replaceAllFindMatches,
  setFindQuery,
  stepFindMatch,
  useFindShortcut,
} from '@/platform/lib/data/files/markdown'
import { toast } from '@/platform/shared/toast'

/** The class the find plugin puts on the active match. */
const ACTIVE_MATCH_SELECTOR = "[class~='rich-find-match-active']"

export interface MarkdownFindController {
  isOpen: boolean
  query: string
  count: number
  currentIndex: number
  truncated: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  replacement: string
  setQuery: (query: string) => void
  setReplacement: (replacement: string) => void
  next: () => void
  prev: () => void
  replaceCurrent: () => void
  replaceAll: () => void
  close: () => void
}

interface FindTally {
  count: number
  currentIndex: number
  truncated: boolean
}

const EMPTY_TALLY: FindTally = { count: 0, currentIndex: 0, truncated: false }

function warnReplacementLimit(): void {
  toast.warning('Replacement is too large', {
    description: 'Use the source editor for changes that exceed the rich-text editing limit.',
  })
}

interface UseMarkdownFindOptions {
  editor: Editor | null
  /** Whether this editor claims Cmd/Ctrl+F. */
  enabled: boolean
}

/**
 * Find and replace in the document. The match set lives in the editor plugin, which re-searches on
 * every change; this mirrors only the tally the bar shows, and reveals each match as it activates.
 */
export function useMarkdownFind({
  editor,
  enabled,
}: UseMarkdownFindOptions): MarkdownFindController {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [replacement, setReplacement] = useState('')
  const [tally, setTally] = useState<FindTally>(EMPTY_TALLY)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef(editor)
  editorRef.current = editor

  const revealActiveMatch = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.view.dom
        .querySelector(ACTIVE_MATCH_SELECTOR)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [])

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

  useEffect(() => {
    if (!editor || !isOpen) return
    syncTally()
    editor.on('transaction', syncTally)
    return () => {
      editor.off('transaction', syncTally)
    }
  }, [editor, isOpen, syncTally])

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

  const replaceCurrent = useCallback(() => {
    const current = editorRef.current
    if (!current || !replaceActiveFindMatch(current, replacement, warnReplacementLimit)) return
    revealActiveMatch()
  }, [replacement, revealActiveMatch])

  const replaceAll = useCallback(() => {
    const current = editorRef.current
    if (current) replaceAllFindMatches(current, replacement, warnReplacementLimit)
  }, [replacement])

  /** Closing ends the search: term, highlights and active match all go. */
  const close = useCallback(() => {
    setIsOpen(false)
    setQueryState('')
    setReplacement('')
    setTally(EMPTY_TALLY)
    const current = editorRef.current
    if (current) setFindQuery(current, '')
    requestAnimationFrame(() => {
      if (current && !current.isDestroyed) current.commands.focus()
    })
  }, [])

  const open = useCallback(() => setIsOpen(true), [])
  useFindShortcut({ enabled, inputRef, onOpen: open })

  return {
    isOpen,
    query,
    replacement,
    count: tally.count,
    currentIndex: tally.currentIndex,
    truncated: tally.truncated,
    inputRef,
    setQuery,
    setReplacement,
    next,
    prev,
    replaceCurrent,
    replaceAll,
    close,
  }
}
