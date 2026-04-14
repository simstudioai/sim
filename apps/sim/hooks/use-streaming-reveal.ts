'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Finds the last paragraph break (`\n\n`) that is not inside a fenced code
 * block. Returns the index immediately after the break — the start of the
 * next paragraph — so the caller can slice cleanly.
 */
function findSafeSplitPoint(content: string): number {
  let inCodeBlock = false
  let lastSafeBreak = 0
  let i = 0

  while (i < content.length) {
    const isBacktickFence = content[i] === '`' && content[i + 1] === '`' && content[i + 2] === '`'
    const isTildeFence = content[i] === '~' && content[i + 1] === '~' && content[i + 2] === '~'

    if (isBacktickFence || isTildeFence) {
      inCodeBlock = !inCodeBlock
      i += 3
      continue
    }

    if (!inCodeBlock && content[i] === '\n' && content[i + 1] === '\n') {
      lastSafeBreak = i + 2
      i += 2
      continue
    }

    i++
  }

  return lastSafeBreak
}

interface StreamingRevealResult {
  /** Stable head — paragraphs that have fully arrived. Ideal for memoisation. */
  committed: string
  /** Active tail — the paragraph currently being streamed. */
  incoming: string
  /** Increments each time committed advances; use to reset per-paragraph animation state. */
  generation: number
}

/**
 * Splits streaming markdown into a stable *committed* head and an active
 * *incoming* tail. The split always occurs at a paragraph boundary (`\n\n`)
 * that is outside fenced code blocks, so both halves are valid markdown.
 *
 * The split is preserved after streaming ends to prevent layout shifts. It
 * only resets when content clears (new message).
 */
export function useStreamingReveal(content: string, isStreaming: boolean): StreamingRevealResult {
  const [committedEnd, setCommittedEnd] = useState(0)
  const [generation, setGeneration] = useState(0)
  const prevSplitRef = useRef(0)

  useEffect(() => {
    if (content.length === 0) {
      prevSplitRef.current = 0
      setCommittedEnd(0)
      return
    }

    if (!isStreaming) return

    const splitPoint = findSafeSplitPoint(content)
    if (splitPoint > prevSplitRef.current) {
      prevSplitRef.current = splitPoint
      setCommittedEnd(splitPoint)
      setGeneration((g) => g + 1)
    }
  }, [content, isStreaming])

  if (!isStreaming) {
    const preservedSplit = prevSplitRef.current

    if (preservedSplit > 0 && preservedSplit < content.length) {
      return {
        committed: content.slice(0, preservedSplit),
        incoming: content.slice(preservedSplit),
        generation,
      }
    }

    return { committed: content, incoming: '', generation }
  }

  if (committedEnd > 0 && committedEnd < content.length) {
    return {
      committed: content.slice(0, committedEnd),
      incoming: content.slice(committedEnd),
      generation,
    }
  }

  if (committedEnd === 0 && content.length > 0) {
    return { committed: '', incoming: content, generation }
  }

  return { committed: content, incoming: '', generation }
}
