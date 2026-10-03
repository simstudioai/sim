'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** How long the `copied` flag stays true before resetting. Defaults to 2000ms. */
  resetMs?: number
}

export interface DeferredClipboardContent {
  /** Safe text that can be written immediately when promise-backed writes are unavailable. */
  fallback: string
  /** Produces the preferred text when the browser supports promise-backed clipboard items. */
  prepare: () => Promise<string>
}

export type ClipboardContent = string | DeferredClipboardContent

interface UseCopyToClipboardReturn {
  copied: boolean
  copy: (content: ClipboardContent) => Promise<boolean>
}

/**
 * Starts an async clipboard write while the caller still has transient user activation.
 * Deferred text uses `ClipboardItem` when available and an immediate fallback otherwise.
 */
export function writeTextToClipboard(content: ClipboardContent): Promise<void> {
  if (typeof content === 'string') return navigator.clipboard.writeText(content)

  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    const blob = Promise.resolve()
      .then(() => content.prepare())
      .then((value) => new Blob([value], { type: 'text/plain' }))
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
  }

  return navigator.clipboard.writeText(content.fallback)
}

/**
 * Copy text to the clipboard with a transient `copied` flag for swap-icon
 * feedback (e.g. Copy → Check for ~2s).
 *
 * Replaces the `[copied, setCopied] + setTimeout` boilerplate that's been
 * duplicated across ~30 callsites. Each `copy()` call resets the timer so
 * back-to-back copies don't stack timeouts; the timer is cleared on unmount.
 *
 * @example
 *   const { copied, copy } = useCopyToClipboard()
 *   <button onClick={() => copy(value)}>
 *     {copied ? <Check /> : <Copy />}
 *   </button>
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { resetMs = 2000 } = options
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(
    async (content: ClipboardContent): Promise<boolean> => {
      try {
        await writeTextToClipboard(content)
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), resetMs)
        return true
      } catch {
        return false
      }
    },
    [resetMs]
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  return { copied, copy }
}
