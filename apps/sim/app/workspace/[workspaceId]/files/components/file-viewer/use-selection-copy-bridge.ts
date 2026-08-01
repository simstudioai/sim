'use client'

import { type RefObject, useEffect } from 'react'
import { attachSelectionContextToClipboard } from '@/lib/copilot/chat/selection-clipboard'
import type { ChatContext } from '@/stores/panel'

/**
 * Rides a selection {@link ChatContext} onto the editor's native copy so a
 * highlighted passage copied with Cmd+C pastes into Chat as a reference chip.
 *
 * Attached in the BUBBLE phase so it runs after the inner editor's own copy
 * handler — Monaco and ProseMirror both `clearData()` before writing
 * `text/plain`, so the custom type must be added last to survive.
 *
 * @param buildContext - Returns null when there is no non-empty selection.
 * @param enabled - Re-runs the effect for a container that mounts late (behind a
 * loading gate); a ref isn't reactive, so the effect would otherwise bail on the
 * first render and never re-attach.
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
