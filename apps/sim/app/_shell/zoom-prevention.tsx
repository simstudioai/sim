'use client'

import { useEffect } from 'react'

export function ZoomPrevention() {
  useEffect(() => {
    const preventZoom = (e: KeyboardEvent | WheelEvent) => {
      // Prevent zoom on ctrl/cmd + wheel
      if (e instanceof WheelEvent && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
      }

      // Prevent zoom on ctrl/cmd + plus/minus/zero
      if (e instanceof KeyboardEvent && (e.ctrlKey || e.metaKey)) {
        if (e.key === '=' || e.key === '-' || e.key === '0') {
          e.preventDefault()
        }
      }
    }

    // Add event listeners
    document.addEventListener('wheel', preventZoom, { passive: false })
    document.addEventListener('keydown', preventZoom)

    // Cleanup
    return () => {
      document.removeEventListener('wheel', preventZoom)
      document.removeEventListener('keydown', preventZoom)
    }
  }, [])

  return null
}
