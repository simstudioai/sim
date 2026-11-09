'use client'

import { type RefObject, useEffect, useRef } from 'react'

/**
 * Prevents browser zoom (Ctrl/Cmd + wheel) on the referenced element.
 * Use this hook on overlay components that sit above the canvas to prevent
 * accidental zoom when scrolling over them.
 *
 * @returns A ref to attach to the container element
 */
export function usePreventZoom<T extends HTMLElement = HTMLDivElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
      }
    }

    element.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      element.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return ref
}
