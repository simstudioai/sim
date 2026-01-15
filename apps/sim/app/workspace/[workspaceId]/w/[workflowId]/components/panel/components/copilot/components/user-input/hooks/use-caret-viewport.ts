import { useMemo } from 'react'

interface CaretViewportPosition {
  left: number
  top: number
}

interface UseCaretViewportResult {
  caretViewport: CaretViewportPosition | null
  side: 'top' | 'bottom'
}

interface UseCaretViewportProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  message: string
  caretPos: number
}

/**
 * Calculates the viewport position of the caret in a textarea using the mirror div technique.
 * This hook memoizes the calculation to prevent unnecessary DOM manipulation on every render.
 */
export function useCaretViewport({
  textareaRef,
  message,
  caretPos,
}: UseCaretViewportProps): UseCaretViewportResult {
  return useMemo(() => {
    const textareaEl = textareaRef.current
    if (!textareaEl) {
      return { caretViewport: null, side: 'bottom' as const }
    }

    const textareaRect = textareaEl.getBoundingClientRect()
    const style = window.getComputedStyle(textareaEl)

    const mirrorDiv = document.createElement('div')
    mirrorDiv.style.position = 'absolute'
    mirrorDiv.style.visibility = 'hidden'
    mirrorDiv.style.whiteSpace = 'pre-wrap'
    mirrorDiv.style.overflowWrap = 'break-word'
    mirrorDiv.style.font = style.font
    mirrorDiv.style.padding = style.padding
    mirrorDiv.style.border = style.border
    mirrorDiv.style.width = style.width
    mirrorDiv.style.lineHeight = style.lineHeight
    mirrorDiv.style.boxSizing = style.boxSizing
    mirrorDiv.style.letterSpacing = style.letterSpacing
    mirrorDiv.style.textTransform = style.textTransform
    mirrorDiv.style.textIndent = style.textIndent
    mirrorDiv.style.textAlign = style.textAlign
    mirrorDiv.textContent = message.substring(0, caretPos)

    const caretMarker = document.createElement('span')
    caretMarker.style.display = 'inline-block'
    caretMarker.style.width = '0px'
    caretMarker.style.padding = '0'
    caretMarker.style.border = '0'
    mirrorDiv.appendChild(caretMarker)

    document.body.appendChild(mirrorDiv)
    const markerRect = caretMarker.getBoundingClientRect()
    const mirrorRect = mirrorDiv.getBoundingClientRect()
    document.body.removeChild(mirrorDiv)

    const caretViewport = {
      left: textareaRect.left + (markerRect.left - mirrorRect.left) - textareaEl.scrollLeft,
      top: textareaRect.top + (markerRect.top - mirrorRect.top) - textareaEl.scrollTop,
    }

    const margin = 8
    const spaceBelow = window.innerHeight - caretViewport.top - margin
    const side: 'top' | 'bottom' = spaceBelow >= caretViewport.top - margin ? 'bottom' : 'top'

    return { caretViewport, side }
  }, [textareaRef, message, caretPos])
}
