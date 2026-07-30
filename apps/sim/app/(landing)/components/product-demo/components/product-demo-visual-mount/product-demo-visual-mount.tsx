'use client'

import dynamic from 'next/dynamic'
import { useLazyMount } from '@/app/(landing)/hooks/use-lazy-mount'

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
 * Gated on viewport proximity via {@link useLazyMount} so the below-the-fold
 * section doesn't pull the animation's JS - or start its
 * `requestAnimationFrame` loop - into the initial homepage load. The parent
 * frame (`product-demo.tsx`) already reserves fixed pixel dimensions for this
 * slot, so there is no placeholder to size - an empty div holds the spot with
 * zero layout shift.
 */
export function ProductDemoVisualMount() {
  const { ref, inView } = useLazyMount('400px')

  return (
    <div ref={ref} className='absolute inset-0'>
      {inView && <HeroVisual />}
    </div>
  )
}
