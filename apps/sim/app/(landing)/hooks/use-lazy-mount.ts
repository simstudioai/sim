'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Gates mounting a heavy client island on viewport proximity via
 * {@link IntersectionObserver}, so its bundle (and any `requestAnimationFrame`
 * loop) only loads once the section nears the viewport instead of on initial
 * page load. Falls back to an eager mount when `IntersectionObserver` is
 * unavailable, so the section never gets stuck unmounted.
 *
 * Pair with `next/dynamic(..., { ssr: false })` for the mounted component.
 */
export function useLazyMount(rootMargin: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true)
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  return { ref, inView }
}
