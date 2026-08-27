'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@sim/emcn'
import { assessTextPaste, formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'

const EDITABLE_TARGET_SELECTOR =
  'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, [contenteditable]:not([contenteditable="false"]), .monaco-editor, .xterm'

function finitePositiveAttribute(element: Element | null, name: string): number | undefined {
  const raw = element?.getAttribute(name)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function contentEditableSelection(element: HTMLElement): {
  currentText: string
  selectionStart: number
  selectionEnd: number
} {
  const currentText = element.textContent ?? ''
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { currentText, selectionStart: currentText.length, selectionEnd: currentText.length }
  }

  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return { currentText, selectionStart: currentText.length, selectionEnd: currentText.length }
  }

  const before = document.createRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  const selectionStart = before.toString().length
  return {
    currentText,
    selectionStart,
    selectionEnd: selectionStart + range.toString().length,
  }
}

/**
 * Last-resort admission for every editable workspace surface. Specialized editors publish a larger
 * or smaller payload ceiling on an ancestor with `data-paste-max-bytes`; controls without one inherit
 * the Socket.IO-sized default. The capture listener runs before React, ProseMirror, Monaco, and xterm
 * can parse or render the clipboard value.
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

      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return

      const policyElement = event.target.closest('[data-paste-max-bytes]')
      const maxPastedBytes =
        finitePositiveAttribute(policyElement, 'data-paste-max-bytes') ?? PASTE_LIMITS.DEFAULT_BYTES
      const maxPastedCharacters = finitePositiveAttribute(
        policyElement,
        'data-paste-max-characters'
      )
      const nativeControl =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      const editableElement = event.target.closest<HTMLElement>(
        '[contenteditable]:not([contenteditable="false"])'
      )
      const projectedValue = nativeControl
        ? {
            currentText: event.target.value,
            selectionStart: event.target.selectionStart ?? event.target.value.length,
            selectionEnd: event.target.selectionEnd ?? event.target.value.length,
          }
        : editableElement
          ? contentEditableSelection(editableElement)
          : null
      const admission = assessTextPaste({
        pastedText: text,
        maxPastedBytes,
        maxPastedCharacters,
        ...(projectedValue
          ? {
              ...projectedValue,
              maxResultBytes: maxPastedBytes,
              maxResultCharacters: maxPastedCharacters,
            }
          : {}),
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
