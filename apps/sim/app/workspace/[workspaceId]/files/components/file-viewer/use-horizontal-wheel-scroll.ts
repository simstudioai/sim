'use client'

import { useCallback, useRef } from 'react'
import { bindPreviewHorizontalWheel } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-wheel-zoom'

/**
 * Ref callback that gives a preview scroll container horizontal wheel scrolling.
 *
 * The tabular previews render a table wider than its frame, and a mouse whose wheel
 * reports only `deltaY` has no native way to reach the overflow short of dragging the
 * scrollbar. Binding is done through a ref callback rather than an effect so the
 * listener attaches with the node and detaches when React passes `null`.
 */
export function useHorizontalWheelScroll() {
  const unbindRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLDivElement | null) => {
    unbindRef.current?.()
    unbindRef.current = node ? bindPreviewHorizontalWheel(node) : null
  }, [])
}
