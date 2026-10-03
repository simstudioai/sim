'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useProductDemoBeat } from '@/app/(landing)/components/product-demo/components/product-demo-caption'
import { useLazyMount } from '@/app/(landing)/hooks/use-lazy-mount'

/**
 * Air kept between the overlaid caption's last line and the scene: with the
 * title 37px tall this puts the scene 81px under the copy's inset, one pixel
 * past the frame's top copy band (`CopyBands`), so the scene never sits in
 * the blur's taper.
 */
const CAPTION_CLEARANCE_GAP = 44

/**
 * `ssr: false` so the loop's client bundle (framer-motion included) never
 * ships in the server-rendered HTML for a section that starts below the fold.
 */
const ComposerLoop = dynamic(
  () =>
    import('@/app/(landing)/components/product-demo/components/composer-loop').then(
      (mod) => mod.ComposerLoop
    ),
  { ssr: false }
)

/**
 * Client mount for the {@link ComposerLoop} island in the Product Demo
 * section - the gooey composer loop. Isolated here so `ProductDemo` stays a
 * Server Component: only this leaf is `'use client'`.
 *
 * Gated on viewport proximity via {@link useLazyMount} so the below-the-fold
 * section doesn't pull the loop's JS - or start its timers - into the
 * initial homepage load. The parent frame reserves the stage's box, so an
 * empty div holds the spot with zero layout shift.
 *
 * It also measures how far the section's caption reaches down into the stage
 * (from `lg` the caption overlays the top of a stage that fills the frame;
 * below, it sits above the stage and the clearance is zero) and passes that
 * to the loop, so the scene stays centred in the frame and clear of the copy
 * at every size. The loop's beats go the other way, to the caption.
 */
export function ProductDemoVisualMount() {
  const { ref, inView } = useLazyMount('400px')
  const { setBeat } = useProductDemoBeat()
  const [clearance, setClearance] = useState(0)

  useEffect(() => {
    const stage = ref.current
    const caption = stage
      ?.closest('section')
      ?.querySelector<HTMLElement>('[data-product-demo-caption]')
    if (!stage || !caption) return
    const measure = () => {
      const reach = caption.getBoundingClientRect().bottom - stage.getBoundingClientRect().top
      setClearance(Math.max(0, Math.round(reach) + CAPTION_CLEARANCE_GAP))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(caption)
    return () => observer.disconnect()
  }, [ref])

  return (
    <div ref={ref} className='absolute inset-0'>
      {inView && <ComposerLoop clearance={clearance} onBeat={setBeat} />}
    </div>
  )
}
