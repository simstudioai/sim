import { useCallback, useEffect, useMemo, useState } from 'react'
import { posToDOMRect } from '@tiptap/core'
import type { Editor } from '@tiptap/react'

/**
 * A Floating UI virtual element anchored to the current selection. The rect is recomputed on every
 * call rather than cached by selection: the same `from`/`to` maps to a different screen position as
 * the pane scrolls, so a cached rect would freeze the toolbar in place. `contextElement` is the
 * editor DOM so Floating UI resolves clipping (and the `hide` middleware) against the editor's
 * scroll container, hiding the toolbar once the selection leaves the pane — not just the viewport.
 * Returns `null` before the editor mounts so the caller skips positioning.
 */
function selectionVirtualElement(editor: Editor) {
  const { view, state } = editor
  if (!view.dom.isConnected) return null
  const { from, to } = state.selection
  const rect = posToDOMRect(view, from, to)
  return {
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
    contextElement: view.dom,
  }
}

/**
 * BubbleMenu Floating UI options. `scrollTarget` is load-bearing: TipTap's reposition listener
 * defaults to `window`, but the editor scrolls inside an inner overflow container that never fires a
 * window scroll — passing the container makes the toolbar track the selection as the pane scrolls.
 * `hide` removes the toolbar once the selection scrolls out of view; `fixed` positions it relative
 * to the viewport so an overflow ancestor can't clip it.
 */
function bubbleMenuFloatingOptions(scrollTarget: HTMLElement | null) {
  return { strategy: 'fixed' as const, scrollTarget: scrollTarget ?? undefined, hide: true }
}

/** Renders the toolbar into `<body>` so a clipping or transformed ancestor can't reparent or shift it. */
const appendTo = () => document.body

/**
 * Wires a BubbleMenu's Floating UI concerns — the selection anchor, positioning options, and the
 * body portal — so the text and table toolbars share one source of truth and can't drift. Captures
 * the parent-owned scroll container into state so `options` gains a new identity once the element
 * resolves, which is what makes the BubbleMenu bind its scroll listener to the pane.
 */
export function useBubbleMenuFloating(
  editor: Editor,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
) {
  const [scrollTarget, setScrollTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setScrollTarget(scrollContainerRef.current)
  }, [scrollContainerRef])

  const resolveAnchor = useCallback(() => selectionVirtualElement(editor), [editor])
  const options = useMemo(() => bubbleMenuFloatingOptions(scrollTarget), [scrollTarget])

  return { resolveAnchor, options, appendTo }
}
