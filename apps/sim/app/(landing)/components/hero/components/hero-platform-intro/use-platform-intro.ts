'use client'

import { useEffect, useRef } from 'react'

interface PlatformIntroOptions {
  onComplete: (reducedMotion: boolean) => void
}

/** Starts the exchange once visible, unless the visitor takes control first. */
export function usePlatformIntro({ onComplete }: PlatformIntroOptions) {
  const rootRef = useRef<HTMLDivElement>(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root || finishedRef.current) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cancelled = false
    let observer: IntersectionObserver | undefined

    const finish = (reducedMotion: boolean) => {
      if (cancelled || finishedRef.current) return
      finishedRef.current = true
      observer?.disconnect()
      onComplete(reducedMotion)
    }
    const cancelAutoplay = () => {
      finishedRef.current = true
      observer?.disconnect()
    }
    const syncMotionPreference = () => {
      if (media.matches) finish(true)
    }

    syncMotionPreference()
    if (!finishedRef.current) {
      if (typeof IntersectionObserver === 'undefined') finish(false)
      else {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) finish(false)
          },
          { threshold: 0.15 }
        )
        observer.observe(root)
      }
    }
    root.addEventListener('pointerdown', cancelAutoplay, true)
    root.addEventListener('focusin', cancelAutoplay)
    media.addEventListener('change', syncMotionPreference)
    return () => {
      cancelled = true
      observer?.disconnect()
      root.removeEventListener('pointerdown', cancelAutoplay, true)
      root.removeEventListener('focusin', cancelAutoplay)
      media.removeEventListener('change', syncMotionPreference)
    }
  }, [onComplete])

  return { rootRef }
}
