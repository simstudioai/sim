'use client'

import { useState } from 'react'
import { useFeedbackExpiry } from '@/platform/design-system/components/feedback/use-feedback-expiry'

export function useClipboard() {
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  useFeedbackExpiry(copiedAt, () => setCopiedAt(null))
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAt(performance.now())
      return true
    } catch {
      setCopiedAt(null)
      return false
    }
  }
  return { copied: copiedAt !== null, copy }
}
