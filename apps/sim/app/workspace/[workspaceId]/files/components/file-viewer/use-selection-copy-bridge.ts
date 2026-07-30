'use client'

import { type RefObject, useEffect } from 'react'
import { attachSelectionContextToClipboard } from '@/lib/copilot/chat/selection-clipboard'
import type { ChatContext } from '@/stores/panel'

/**
 * Rides a selection {@link ChatContext} onto the editor's native copy so a
 * highlighted passage copied with Cmd+C pastes into Chat as a reference chip.
 *
 * The listener is attached to `containerRef` in the BUBBLE phase so it runs
 * AFTER the inner editor's own copy handler (Monaco and ProseMirror both call
 * `clearData()` then write `text/plain`/`text/html`) — the custom
 * `text/x-sim-selection` type is added last and survives, leaving normal copy
 * untouched. `buildContext` returns `null` when there is no non-empty selection.
 *
 * `enabled` lets a caller whose container mounts late (e.g. behind a loading
 * gate) re-run the effect once the node exists — a ref object isn't reactive, so
 * without it the effect would bail on the first render and never re-attach.
 */
export function useSelectionCopyBridge(
  containerRef: RefObject<HTMLElement | null>,
  buildContext: () => ChatContext | null,
  enabled = true
): void {
  useEffect(() => {
    const dom = containerRef.current
    if (!dom || !enabled) return
    const onCopy = (e: ClipboardEvent) => {
      const context = buildContext()
      if (context) attachSelectionContextToClipboard(e.clipboardData, context)
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [containerRef, buildContext, enabled])
}
