'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { HOME_TYPE } from '@/app/(landing)/components/landing-layout'
import {
  DEMO_BEATS,
  type DemoBeatId,
} from '@/app/(landing)/components/product-demo/components/product-demo-caption/beats'
import { useProductDemoBeat } from '@/app/(landing)/components/product-demo/components/product-demo-caption/context'
import styles from '@/app/(landing)/components/product-demo/components/product-demo-caption/product-demo-caption.module.css'

/** How long the outgoing title takes to dissolve under the incoming one. */
const EXIT_MS = 320
/**
 * The incoming title rises in. No fill after the end, so the title's resting
 * styles - the keyframe's end - are what the exit transition later takes over.
 */
const ENTER = styles.enter
const TITLE =
  'col-start-1 row-start-1 mx-auto max-w-[26ch] text-balance text-[#3B3B3B] dark:text-[var(--text-secondary)]'
const EXIT = 'pointer-events-none opacity-0'

interface ProductDemoCaptionProps {
  /** Placement within the frame; the block itself is a centred title. */
  className?: string
}

/**
 * The section's heading, following the scene act by act. When the loop moves
 * to the next beat the title on show dissolves in place while the next one
 * rises in over it, so the copy never blinks out to an empty frame. The first
 * title is server-rendered and arrives still; only changes animate. The `h2`
 * keeps its id across titles, so the band's accessible name follows the copy.
 * The wrapper is what the visual mount measures to keep the scene clear of
 * the copy.
 */
export function ProductDemoCaption({ className }: ProductDemoCaptionProps) {
  const { beat } = useProductDemoBeat()
  const [shown, setShown] = useState<DemoBeatId>(beat)
  const [leaving, setLeaving] = useState<DemoBeatId | null>(null)
  const [changed, setChanged] = useState(false)

  if (beat !== shown) {
    setLeaving(shown)
    setShown(beat)
    setChanged(true)
  }

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLeaving(null), EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  return (
    <div
      data-product-demo-caption
      className={cn(
        'relative z-10 mx-auto grid w-full max-w-[40rem] shrink-0 text-center',
        className
      )}
    >
      {leaving && (
        <p
          key={leaving}
          aria-hidden='true'
          className={cn(
            TITLE,
            HOME_TYPE.h3,
            'transition-opacity duration-300 ease-out motion-reduce:transition-none',
            EXIT
          )}
        >
          {DEMO_BEATS[leaving]}
        </p>
      )}
      <h2
        key={shown}
        id='product-demo-heading'
        className={cn(TITLE, HOME_TYPE.h3, changed && ENTER)}
      >
        {DEMO_BEATS[shown]}
      </h2>
    </div>
  )
}
