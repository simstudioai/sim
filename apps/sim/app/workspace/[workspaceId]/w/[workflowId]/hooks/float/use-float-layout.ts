import { type RefObject, useCallback } from 'react'

interface UseFloatLayoutProps {
  ref: RefObject<HTMLDivElement | null>
  onPositionChange: (position: { x: number; y: number }) => void
  onDimensionsChange?: (dimensions: { width: number; height: number }) => void
}

/** Preserves desktop geometry while CSS presents the panel as a compact overlay. */
export function useFloatLayout({ ref, onPositionChange, onDimensionsChange }: UseFloatLayoutProps) {
  const isFloatingLayout = useCallback(() => {
    const element = ref.current
    return element !== null && getComputedStyle(element).position === 'fixed'
  }, [ref])

  const updatePosition = useCallback(
    (position: { x: number; y: number }) => {
      if (isFloatingLayout()) onPositionChange(position)
    },
    [isFloatingLayout, onPositionChange]
  )

  const updateDimensions = useCallback(
    (dimensions: { width: number; height: number }) => {
      if (isFloatingLayout()) onDimensionsChange?.(dimensions)
    },
    [isFloatingLayout, onDimensionsChange]
  )

  return { isFloatingLayout, updatePosition, updateDimensions }
}
