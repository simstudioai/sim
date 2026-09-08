'use client'

import { type PointerEvent, useEffect, useRef } from 'react'
import { cn } from '@sim/emcn'
import Image from 'next/image'
import { LOGOS, MUTED_MARK } from '@/app/(landing)/components/logos'
import styles from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-logo-marquee/nav-menu-logo-marquee.module.css'

/**
 * The track holds two identical copies of the row and slides by half its
 * width per cycle, so the seam lands exactly where the next copy begins and
 * the loop never visibly restarts. Every copy is bounded to keep the cadence
 * even: a copy is about 800px, so 16s is roughly 50px/s.
 */
const COPIES = [0, 1] as const
const EDGE_FADE =
  '[mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]'
const LABEL = 'Companies building and governing AI agents with Sim'
const KEYBOARD_STEP = 120

interface MarqueeDrag {
  pointerId: number
  lastX: number
}

function moveTrack(track: HTMLDivElement | null, distance: number) {
  const animation = track?.getAnimations()[0]
  const duration = animation?.effect?.getComputedTiming().duration
  const width = (track?.offsetWidth ?? 0) / COPIES.length
  if (!animation || typeof duration !== 'number' || !duration || !width) return

  const time = Number(animation.currentTime ?? 0) - (distance / width) * duration
  animation.currentTime = ((time % duration) + duration) % duration
}

/**
 * The customer wordmarks sliding in a muted band under a floating menu's
 * blocs - the homepage's shared logo set at its optical sizes, the way the
 * platform pages show them. The second copy of the row exists only for the
 * seamless loop and is hidden from assistive technology; a reduced-motion
 * preference leaves the row still. Dragging, trackpad scrolling, and arrow
 * keys scrub the same animation timeline, preserving its position when
 * autoplay resumes.
 */
export function NavMenuLogoMarquee() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<MarqueeDrag | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || dragRef.current) return
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0)
      if (!delta || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX))) return

      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientWidth
            : 1
      if (event.cancelable) event.preventDefault()
      moveTrack(trackRef.current, -delta * unit)
    }

    /** Native wheel deltas include trackpad momentum; non-passive handling keeps horizontal swipes in the carousel. */
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={viewportRef}
      role='region'
      aria-label='Customer logos'
      aria-description='Drag, scroll horizontally, or use the left and right arrow keys to browse customer logos.'
      /** biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can scrub this carousel with the arrow keys. */
      tabIndex={0}
      className={cn(
        'cursor-grab touch-pan-y touch-pinch-zoom select-none overflow-hidden py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-secondary)] focus-visible:outline-offset-[-2px] data-[dragging]:cursor-grabbing',
        styles.viewport,
        EDGE_FADE
      )}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        event.preventDefault()
        dragRef.current = { pointerId: event.pointerId, lastX: event.clientX }
        event.currentTarget.dataset.dragging = ''
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        moveTrack(trackRef.current, event.clientX - drag.lastX)
        drag.lastX = event.clientX
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        moveTrack(trackRef.current, event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP)
      }}
    >
      <div
        ref={trackRef}
        className={cn(
          'flex w-max items-center will-change-transform [backface-visibility:hidden]',
          styles.track
        )}
      >
        {COPIES.map((copy) => {
          const decorative = copy > 0
          return (
            <ul
              key={copy}
              aria-hidden={decorative || undefined}
              aria-label={decorative ? undefined : LABEL}
              className='flex w-max items-center'
            >
              {LOGOS.map((logo) => (
                <li key={logo.name} className='flex shrink-0 items-center px-6'>
                  <Image
                    src={logo.src}
                    alt={decorative ? '' : logo.name}
                    height={logo.height}
                    width={Math.round(logo.height * logo.aspect)}
                    loading='lazy'
                    draggable={false}
                    className={cn('pointer-events-none', MUTED_MARK)}
                  />
                </li>
              ))}
            </ul>
          )
        })}
      </div>
    </div>
  )
}
