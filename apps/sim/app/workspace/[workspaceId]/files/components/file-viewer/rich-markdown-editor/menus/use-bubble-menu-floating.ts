import { useCallback, useEffect, useRef } from 'react'
import { autoUpdate } from '@floating-ui/dom'
import { posToDOMRect } from '@tiptap/core'
import { AllSelection, type PluginKey, type Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/**
 * A whole-document selection has a viewport-sized bounding box, which gives Floating UI no viable
 * side to flip to and leaves the toolbar clipped above the editor. Anchor that semantic selection to
 * the document's leading position; every ordinary selection keeps its complete range geometry.
 */
export function bubbleMenuAnchorRange(selection: Selection): { from: number; to: number } {
  if (selection instanceof AllSelection) return { from: selection.from, to: selection.from }
  return { from: selection.from, to: selection.to }
}

/**
 * A Floating UI virtual element anchored to the current selection. The rect is recomputed on every
 * call rather than cached by selection: the same `from`/`to` maps to a different screen position as
 * the pane scrolls, so a cached rect would freeze the toolbar in place. Returns `null` before the
 * editor mounts so the caller skips positioning.
 */
function selectionVirtualElement(editor: Editor) {
  const { view, state } = editor
  if (!view.dom.isConnected) return null
  const { from, to } = bubbleMenuAnchorRange(state.selection)
  const rect = posToDOMRect(view, from, to)
  return {
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
    contextElement: view.dom,
  }
}

/**
 * Wires a BubbleMenu's Floating UI concerns — the selection anchor and the portal target — so the
 * text and table toolbars share one source of truth and can't drift.
 *
 * The toolbar stays inside the editor's scroll container. Its controls can resize after a selection
 * changes, and a table can scroll independently of the document, so track both through Floating UI.
 */
export function useBubbleMenuFloating(
  editor: Editor,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  pluginKey: PluginKey
) {
  const menuRef = useRef<HTMLDivElement>(null)
  const resolveAnchor = useCallback(() => selectionVirtualElement(editor), [editor])
  const appendTo = useCallback(
    () => scrollContainerRef.current ?? document.body,
    [scrollContainerRef]
  )

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    let stop: (() => void) | undefined
    const trackSelection = () => {
      stop?.()
      const { node } = editor.view.domAtPos(editor.state.selection.from)
      const reference = node instanceof Element ? node : (node.parentElement ?? editor.view.dom)
      stop = autoUpdate(reference, menu, () => {
        if (!editor.isDestroyed && menu.isConnected) {
          editor.commands.setMeta(pluginKey, 'updatePosition')
        }
      })
    }
    trackSelection()
    editor.on('selectionUpdate', trackSelection)
    return () => {
      stop?.()
      editor.off('selectionUpdate', trackSelection)
    }
  }, [editor, pluginKey])

  return { resolveAnchor, appendTo, menuRef }
}
