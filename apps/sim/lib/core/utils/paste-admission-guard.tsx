'use client'

import { useEffect } from 'react'
import { pasteRejectionLimit } from '@/lib/core/utils/paste-admission'
import { toast } from '@/lib/toast/sink'

/**
 * Last-resort paste admission for every editable surface, mounted once by each root (the site root
 * and the Platform root). The capture listener refuses an oversized clipboard payload before React,
 * ProseMirror, Monaco, or xterm parse it, and the notice goes to whichever toaster the root connects.
 * Renders nothing.
 */
export function PasteAdmissionGuard() {
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
