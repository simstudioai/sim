'use client'

import { useEffect } from 'react'
import { pasteRejectionLimit } from '@/lib/core/utils/paste-admission'
import { toast } from '@/lib/toast/sink'

/**
 * Last-resort paste admission for every editable field, mounted once by each root. The capture
 * listener refuses an oversized clipboard payload before React, ProseMirror, Monaco or xterm parses
 * it, and raises its notice through the root's toast sink. Renders nothing.
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
