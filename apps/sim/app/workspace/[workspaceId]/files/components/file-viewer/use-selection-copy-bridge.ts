'use client'

import { type RefObject, useEffect } from 'react'
import { attachSelectionContextToClipboard } from '@/lib/mothership/chat/selection-clipboard'
import type { FileOperationOwner } from '@/lib/mothership/generated/file-owner'
import type { ChatContext } from '@/stores/panel'

interface UseSelectionCopyBridgeProps {
  containerRef: RefObject<HTMLElement | null>
  /** Returns null when there is no non-empty selection. */
  buildContext: () => ChatContext | null
  owner: string | FileOperationOwner | undefined
  /** Reattaches when a loading gate mounts the container, since a ref is not reactive. */
  enabled?: boolean
}

/**
 * Rides a selection {@link ChatContext} onto the editor's native copy so a
 * highlighted passage copied with Cmd+C pastes into Chat as a reference chip.
 *
 * Attached in the BUBBLE phase so it runs after the inner editor's own copy
 * handler — Monaco and ProseMirror both `clearData()` before writing
 * `text/plain`, so the custom type must be added last to survive.
 *
 */
export function useSelectionCopyBridge({
  containerRef,
  buildContext,
  owner,
  enabled = true,
}: UseSelectionCopyBridgeProps): void {
  useEffect(() => {
    const dom = containerRef.current
    if (!dom || !enabled || !owner) return
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
      if (context) attachSelectionContextToClipboard(e.clipboardData, context, owner)
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [containerRef, buildContext, owner, enabled])
}
