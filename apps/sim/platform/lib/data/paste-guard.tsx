'use client'

import { useEffect } from 'react'
import { pasteRejectionLimit } from '@/lib/core/utils/paste-admission'
import { toast } from '@/lib/toast/sink'

/**
 * The main app's last-resort paste admission, for the zone's editable fields: the capture listener
 * refuses an oversized clipboard payload before anything parses it. Renders nothing.
 */
export function PasteGuard() {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const limit = pasteRejectionLimit(event)
      if (!limit) return
      event.preventDefault()
      event.stopImmediatePropagation()
      toast.warning('Paste is too large for this editor', {
        description: `The clipboard content was left unchanged. This editor supports up to ${limit}.`,
      })
    }
    document.addEventListener('paste', handlePaste, true)
    return () => document.removeEventListener('paste', handlePaste, true)
  }, [])
  return null
}
