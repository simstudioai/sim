'use client'

import { useState } from 'react'
import { useFeedbackExpiry } from '#emcn/components/feedback/use-feedback-expiry'

interface DeferredClipboardContent {
  prepare: () => Promise<string>
  fallback?: string
}

/** Writes during the initiating gesture and keeps successful feedback for the shared dwell. */
export function useClipboard() {
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  useFeedbackExpiry(copiedAt, () => setCopiedAt(null))
  async function copy(content: string | DeferredClipboardContent): Promise<boolean> {
    try {
      if (typeof content === 'string') {
        await navigator.clipboard.writeText(content)
      } else if (
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator.clipboard.write === 'function'
      ) {
        const blob = Promise.resolve()
          .then(() => content.prepare())
          .then((text) => new Blob([text], { type: 'text/plain' }))
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      } else if (content.fallback !== undefined) {
        await navigator.clipboard.writeText(content.fallback)
      } else {
        setCopiedAt(null)
        return false
      }
      setCopiedAt(performance.now())
      return true
    } catch {
      setCopiedAt(null)
      return false
    }
  }
  return { copied: copiedAt !== null, copy }
}
