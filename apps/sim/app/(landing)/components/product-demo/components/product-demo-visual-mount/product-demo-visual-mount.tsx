'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

/**
 * Load the visual a little before it scrolls into view so it's ready by the
 * time the user reaches it, without paying for it on initial load.
 */
const PRELOAD_ROOT_MARGIN = '400px'

/**
 * `ssr: false` so the animation's client bundle never ships in the
 * server-rendered HTML for a section that starts below the fold.
 */
const HeroVisual = dynamic(
  () =>
    import('@/app/(landing)/components/hero/components/hero-visual/hero-visual').then(
      (mod) => mod.HeroVisual
    ),
  { ssr: false }
)

/**
 * Client mount for the {@link HeroVisual} island reused in the Product Demo
 * section. Isolated here so `ProductDemo` stays a Server Component: only this
 * leaf is `'use client'`.
 *
 * Gated on viewport proximity via {@link IntersectionObserver} so the below-
 * the-fold section doesn't pull the animation's JS - or start its
 * `requestAnimationFrame` loop - into the initial homepage load, mirroring
 * {@link LandingPreviewMount}'s pattern. The parent frame
 * (`product-demo.tsx`) already reserves fixed pixel dimensions for this slot,
 * so there is no placeholder to size - an empty div holds the spot with zero
 * layout shift.
 */
export function ProductDemoVisualMount() {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    // Graceful degradation: without IntersectionObserver support, load eagerly
    // rather than leave the section stuck on its placeholder.
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
      { rootMargin: PRELOAD_ROOT_MARGIN }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView])

  return (
    <div ref={ref} className='absolute inset-0'>
      {inView && <HeroVisual />}
    </div>
  )
}
