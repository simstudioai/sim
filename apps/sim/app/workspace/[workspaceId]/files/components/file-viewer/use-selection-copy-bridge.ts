'use client'

import { type RefObject, useEffect } from 'react'
import { attachSelectionContextToClipboard } from '@/lib/mothership/chat/selection-clipboard'
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
 * @param workspaceId - Workspace that owns the selected resource.
 * @param enabled - Re-runs the effect for a container that mounts late (behind a
 * loading gate); a ref isn't reactive, so the effect would otherwise bail on the
 * first render and never re-attach.
 */
export function useSelectionCopyBridge(
  containerRef: RefObject<HTMLElement | null>,
  buildContext: () => ChatContext | null,
  workspaceId: string,
  enabled = true
): void {
  useEffect(() => {
    const dom = containerRef.current
    if (!dom || !enabled) return
    const onCopy = (e: ClipboardEvent) => {
      // A copy from a field nested in the editor — Monaco's find box being the
      // common one — bubbles here while the document still holds a highlight,
      // so the selection would be attached to text the user never copied.
      //
      // Only INPUT is skipped, deliberately: Monaco's own editing surface is a
      // hidden TEXTAREA, so excluding textareas (as the table grid does, where
      // the cell editors really are form fields) would suppress the chip on the
      // main copy path this hook exists for.
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
      const context = buildContext()
      if (context) attachSelectionContextToClipboard(e.clipboardData, context, workspaceId)
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [containerRef, buildContext, workspaceId, enabled])
}
