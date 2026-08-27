'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@sim/emcn'
import { assessTextPaste, formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import { readSelectionContextFromClipboard } from '@/lib/copilot/chat/selection-clipboard'

const EDITABLE_TARGET_SELECTOR =
  'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, [contenteditable]:not([contenteditable="false"]), .monaco-editor, .xterm'

function finitePositiveAttribute(element: Element | null, name: string): number | undefined {
  const raw = element?.getAttribute(name)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Last-resort admission for every editable workspace surface. Specialized editors publish their
 * downstream ceiling on an ancestor with `data-paste-max-bytes`; controls without one inherit a
 * crash-only fallback. This layer bounds only the clipboard payload, so a small paste into an already
 * large field keeps native behavior. Editors with a real result-size contract enforce it themselves.
 * The capture listener runs before React, ProseMirror, Monaco, and xterm parse the clipboard value.
 */
export function PasteAdmissionGuard() {
  const { toast: notify } = useToast()
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(EDITABLE_TARGET_SELECTOR)) {
        return
      }

      if (readSelectionContextFromClipboard(event.clipboardData)) return

      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return

      const policyElement = event.target.closest('[data-paste-max-bytes]')
      const maxPastedBytes =
        finitePositiveAttribute(policyElement, 'data-paste-max-bytes') ?? PASTE_LIMITS.DEFAULT_BYTES
      const maxPastedCharacters = finitePositiveAttribute(
        policyElement,
        'data-paste-max-characters'
      )
      const admission = assessTextPaste({
        pastedText: text,
        maxPastedBytes,
        maxPastedCharacters,
      })
      if (admission.accepted) return

      event.preventDefault()
      event.stopImmediatePropagation()
      const limit =
        admission.reason === 'pasted-characters'
          ? `${admission.limit.toLocaleString()} characters`
          : formatPasteLimit(admission.limit)
      notifyRef.current.warning('Paste is too large for this editor', {
        description: `The clipboard content was left unchanged. This editor supports up to ${limit}.`,
      })
    }

    document.addEventListener('paste', handlePaste, true)
    return () => document.removeEventListener('paste', handlePaste, true)
  }, [])

  return null
}
