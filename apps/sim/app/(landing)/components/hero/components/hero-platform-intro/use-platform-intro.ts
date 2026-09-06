'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawPlatformPreview } from '@/app/(landing)/components/hero/components/hero-platform-intro/draw-platform-preview'

type IntroPhase = 'waiting' | 'drawing' | 'ready'

interface PlatformIntroOptions {
  onComplete: (reducedMotion: boolean) => void
}

/** One entrance on first visibility; never replays after interaction, theme changes, or resizing. */
export function usePlatformIntro({ onComplete }: PlatformIntroOptions) {
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const finishedRef = useRef(false)
  const animationsRef = useRef<Animation[]>([])
  const [phase, setPhase] = useState<IntroPhase>('waiting')

  useLayoutEffect(() => {
    if (phase !== 'ready') return
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current = []
  }, [phase])

  useEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    const overlay = overlayRef.current
    if (!root || !content || !overlay || finishedRef.current) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animations: Animation[] = []
    animationsRef.current = animations
    let cancelled = false
    let started = false
    let frame = 0
    let observer: IntersectionObserver | undefined
    let resizeObserver: ResizeObserver | undefined

    const finish = (reducedMotion: boolean) => {
      if (cancelled || finishedRef.current) return
      finishedRef.current = true
      observer?.disconnect()
      resizeObserver?.disconnect()
      cancelAnimationFrame(frame)
      setPhase('ready')
      onComplete(reducedMotion)
    }
    const draw = () => {
      if (finishedRef.current || cancelled) return
      frame = requestAnimationFrame(() => {
        if (cancelled || finishedRef.current) return
        setPhase('drawing')
        const reveal = drawPlatformPreview(root, content, overlay, animations)
        void reveal.finished.then(
          () => finish(false),
          () => undefined
        )
        const { width, height } = root.getBoundingClientRect()
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            const bounds = root.getBoundingClientRect()
            if (Math.abs(bounds.width - width) > 1 || Math.abs(bounds.height - height) > 1)
              finish(false)
          })
          resizeObserver.observe(root)
        }
      })
    }
    const begin = () => {
      if (started || finishedRef.current || cancelled) return
      started = true
      observer?.disconnect()
      const background = root
        .closest('[data-preview-stage]')
        ?.querySelector<HTMLImageElement>('[data-preview-background]')
      if (background && !background.complete) {
        void background.decode().then(draw, draw)
      } else draw()
    }
    const syncMotionPreference = () => {
      if (media.matches || typeof content.animate !== 'function') finish(true)
    }

    syncMotionPreference()
    if (!finishedRef.current) {
      if (typeof IntersectionObserver === 'undefined') begin()
      else {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) begin()
          },
          { threshold: 0.15 }
        )
        observer.observe(root)
      }
    }
    media.addEventListener('change', syncMotionPreference)
    return () => {
      cancelled = true
      observer?.disconnect()
      resizeObserver?.disconnect()
      media.removeEventListener('change', syncMotionPreference)
      cancelAnimationFrame(frame)
      animations.forEach((animation) => animation.cancel())
      overlay.replaceChildren()
    }
  }, [onComplete])

  return { rootRef, contentRef, overlayRef, phase }
}
