import { useCallback, useEffect, useState } from 'react'

interface UseShiftSelectionLockProps {
  isHandMode: boolean
}

interface UseShiftSelectionLockResult {
  /** Whether a shift-selection is currently active (locked in until mouseup) */
  isShiftSelecting: boolean
  /** Handler to attach to canvas mousedown */
  handleCanvasMouseDown: (event: React.MouseEvent) => void
  /** Computed ReactFlow props based on current selection state */
  selectionProps: {
    selectionOnDrag: boolean
    panOnDrag: [number, number] | false
    selectionKeyCode: string | null
  }
}

/**
 * Locks shift-selection mode from mousedown to mouseup.
 * Prevents selection from canceling when shift is released mid-drag.
 */
export function useShiftSelectionLock({
  isHandMode,
}: UseShiftSelectionLockProps): UseShiftSelectionLockResult {
  const [isShiftSelecting, setIsShiftSelecting] = useState(false)

  const handleCanvasMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!event.shiftKey) return

      const target = event.target as HTMLElement | null
      const isPaneTarget = Boolean(target?.closest('.react-flow__pane, .react-flow__selectionpane'))

      if (isPaneTarget && isHandMode) {
        setIsShiftSelecting(true)
      }

      if (isPaneTarget) {
        event.preventDefault()
        window.getSelection()?.removeAllRanges()
      }
    },
    [isHandMode]
  )

  useEffect(() => {
    if (!isShiftSelecting) return

    const handleMouseUp = () => setIsShiftSelecting(false)
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [isShiftSelecting])

  const selectionProps = {
    selectionOnDrag: !isHandMode || isShiftSelecting,
    panOnDrag: (isHandMode && !isShiftSelecting ? [0, 1] : false) as [number, number] | false,
    selectionKeyCode: isShiftSelecting ? null : 'Shift',
  }

  return { isShiftSelecting, handleCanvasMouseDown, selectionProps }
}
