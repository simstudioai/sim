import { useCallback, useRef } from 'react'

/**
 * Optimized auto-scroll hook for smooth drag operations
 */
export const useAutoScroll = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  const animationRef = useRef<number | null>(null)
  const speedRef = useRef<number>(0)
  const lastUpdateRef = useRef<number>(0)

  const animateScroll = useCallback(() => {
    const scrollContainer = containerRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement
    if (!scrollContainer || speedRef.current === 0) {
      animationRef.current = null
      return
    }

    const currentScrollTop = scrollContainer.scrollTop
    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight

    // Check bounds and stop if needed
    if (
      (speedRef.current < 0 && currentScrollTop <= 0) ||
      (speedRef.current > 0 && currentScrollTop >= maxScrollTop)
    ) {
      speedRef.current = 0
      animationRef.current = null
      return
    }

    // Apply smooth scroll
    scrollContainer.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, currentScrollTop + speedRef.current)
    )
    animationRef.current = requestAnimationFrame(animateScroll)
  }, [containerRef])

  const startScroll = useCallback(
    (speed: number) => {
      speedRef.current = speed
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(animateScroll)
      }
    },
    [animateScroll]
  )

  const stopScroll = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    speedRef.current = 0
  }, [])

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      const now = performance.now()
      // Throttle to ~16ms for 60fps
      if (now - lastUpdateRef.current < 16) return
      lastUpdateRef.current = now

      const scrollContainer = containerRef.current
      if (!scrollContainer) return

      const rect = scrollContainer.getBoundingClientRect()
      const mouseY = e.clientY

      // Early exit if mouse is outside container
      if (mouseY < rect.top || mouseY > rect.bottom) {
        stopScroll()
        return
      }

      const scrollZone = 50
      const maxSpeed = 4
      const distanceFromTop = mouseY - rect.top
      const distanceFromBottom = rect.bottom - mouseY

      let scrollSpeed = 0

      if (distanceFromTop < scrollZone) {
        const intensity = (scrollZone - distanceFromTop) / scrollZone
        scrollSpeed = -maxSpeed * intensity ** 2
      } else if (distanceFromBottom < scrollZone) {
        const intensity = (scrollZone - distanceFromBottom) / scrollZone
        scrollSpeed = maxSpeed * intensity ** 2
      }

      if (Math.abs(scrollSpeed) > 0.1) {
        startScroll(scrollSpeed)
      } else {
        stopScroll()
      }
    },
    [containerRef, startScroll, stopScroll]
  )

  return { handleDragOver, stopScroll }
}
