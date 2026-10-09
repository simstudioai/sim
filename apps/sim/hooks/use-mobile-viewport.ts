'use client'

import { type RefObject, useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-is-mobile'

interface UseMobileViewportProps {
  ref: RefObject<HTMLDivElement | null>
}

/** Keeps fixed mobile app surfaces above the keyboard without interfering with pinch zoom. */
export function useMobileViewport({ ref }: UseMobileViewportProps) {
  const isMobile = useIsMobile()

  useEffect(() => {
    const element = ref.current
    const viewport = window.visualViewport
    if (!isMobile || !element || !viewport) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (viewport.scale !== 1) return
        element.style.setProperty('--mobile-viewport-height', `${viewport.height}px`)
        element.style.setProperty('--mobile-viewport-top', `${viewport.offsetTop}px`)
      })
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      element.style.removeProperty('--mobile-viewport-height')
      element.style.removeProperty('--mobile-viewport-top')
    }
  }, [isMobile, ref])
}
