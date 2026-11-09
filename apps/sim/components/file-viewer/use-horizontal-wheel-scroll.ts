'use client'

import { useCallback, useRef } from 'react'
import { bindHorizontalWheel } from '@/components/file-viewer/preview-wheel'

/** A ref for a table frame wider than its viewport, so a mouse wheel with Shift reaches it. */
export function useHorizontalWheelScroll() {
  const unbindRef = useRef<(() => void) | null>(null)
  return useCallback((element: HTMLDivElement | null) => {
    unbindRef.current?.()
    unbindRef.current = element ? bindHorizontalWheel(element) : null
  }, [])
}
