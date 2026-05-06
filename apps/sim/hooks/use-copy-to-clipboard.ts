'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseCopyToClipboardOptions {
  /** How long the `copied` flag stays true before resetting. Defaults to 2000ms. */
  resetMs?: number
}

interface UseCopyToClipboardReturn {
  copied: boolean
  copy: (text: string) => Promise<boolean>
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
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text)
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
