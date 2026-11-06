'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@sim/emcn'
import { pasteRejectionLimit } from '@/lib/core/utils/paste-admission'

/**
 * Last-resort admission for every editable workspace surface. The capture listener runs before
 * React, ProseMirror, Monaco, and xterm parse the clipboard value.
 */
export function PasteAdmissionGuard() {
  const { toast: notify } = useToast()
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const limit = pasteRejectionLimit(event)
      if (!limit) return

      event.preventDefault()
      event.stopImmediatePropagation()
      notifyRef.current.warning('Paste is too large for this editor', {
        description: `The clipboard content was left unchanged. This editor supports up to ${limit}.`,
      })
    }

    document.addEventListener('paste', handlePaste, true)
    return () => document.removeEventListener('paste', handlePaste, true)
  }, [])

  return null
}
