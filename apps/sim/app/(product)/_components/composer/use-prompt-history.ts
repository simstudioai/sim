'use client'

import { type KeyboardEvent, type RefObject, useLayoutEffect, useRef } from 'react'
import type { ComposerController, ComposerDraft } from '@/platform/lib/data/models/composer'

/** A message the person sent earlier in this conversation. */
export interface PromptHistoryEntry {
  id: string
  draft: ComposerDraft
}

interface HistoryPosition {
  id: string
  /** The recalled draft as the composer shows it, read once the recall renders. */
  shown?: string
  caret: number | 'end'
}

function draftSignature({ text, attachments }: ComposerDraft): string {
  return JSON.stringify([text, attachments.map((attachment) => attachment.id)])
}

/**
 * Up and Down at the draft's edges browse the conversation's sent messages, starting only from an
 * empty draft and stopping as soon as a recalled draft is edited, as legacy's prompt history did.
 * Down past the newest message empties the draft again.
 */
export function usePromptHistory(
  composer: ComposerController,
  entries: readonly PromptHistoryEntry[] | undefined,
  editor: RefObject<HTMLTextAreaElement | null>
) {
  const position = useRef<HistoryPosition | null>(null)
  useLayoutEffect(() => {
    const current = position.current
    if (!current || current.shown !== undefined) return
    current.shown = draftSignature(composer.draft)
    const input = editor.current
    const caret = current.caret === 'end' ? composer.draft.text.length : current.caret
    input?.setSelectionRange(caret, caret)
  })

  function navigate(direction: -1 | 1): boolean {
    let current = position.current
    if (current && current.shown !== draftSignature(composer.draft)) {
      position.current = null
      current = null
    }
    if (!current && (direction === 1 || composer.draft.text || composer.draft.attachments.length))
      return false
    if (!entries?.length) return false
    let index = current ? entries.findIndex((entry) => entry.id === current.id) : entries.length
    if (current && index < 0) {
      position.current = null
      return false
    }
    index += direction
    const entry = entries[index]
    if (entry) {
      composer.restore(entry.draft)
      position.current = { id: entry.id, caret: direction === -1 ? 0 : 'end' }
      return true
    }
    if (current && direction === 1) {
      composer.clear()
      position.current = null
      return true
    }
    return current !== null
  }

  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
      event.defaultPrevented ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    const input = event.currentTarget
    const direction = event.key === 'ArrowUp' ? -1 : 1
    if (input.selectionStart !== input.selectionEnd) return
    if (input.selectionStart !== (direction === -1 ? 0 : input.value.length)) return
    if (navigate(direction)) event.preventDefault()
  }
}
