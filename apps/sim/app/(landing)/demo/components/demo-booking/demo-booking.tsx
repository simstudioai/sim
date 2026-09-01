'use client'

import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'
import { chipBorderShadowRing, cn } from '@sim/emcn'
import dynamic from 'next/dynamic'
import { preconnect } from 'react-dom'
import { DemoForm, type DemoLead } from '@/app/(landing)/demo/components/demo-form'
import { CAL_ORIGIN } from '@/app/(landing)/demo/components/demo-scheduler/cal-config'
import { applyLegacyInertFallback } from '@/app/(landing)/demo/components/legacy-inert-fallback'

const importScheduler = () => import('@/app/(landing)/demo/components/demo-scheduler')

/**
 * Warm the entire booking path while the visitor fills the form: preconnect to
 * the configured Cal origin, then load the scheduler chunk and the
 * booker iframe assets (via the embed's `preload` instruction). Fired on first
 * form focus so nothing Cal.com-related competes with initial page load — the
 * connection handshake overlaps the chunk import, and it all finishes long
 * before the visitor submits.
 */
function preloadScheduler() {
  preconnect(CAL_ORIGIN)
  return importScheduler().then((m) => m.preloadCalEmbed())
}

/**
 * Lazy-loaded so the Cal.com embed never enters the initial landing bundle - it
 * loads only once a visitor reaches the booking step. `loading: () => null` (no
 * skeleton): the panel is already sized and the slide covers the brief load, so
 * there is no flash-then-resize.
 */
const DemoScheduler = dynamic(() => importScheduler().then((m) => m.DemoScheduler), {
  ssr: false,
  loading: () => null,
})

function useLegacyInertFallback(ref: RefObject<HTMLDivElement | null>, inert: boolean) {
  useEffect(() => {
    const node = ref.current
    if (!inert || !node || 'inert' in HTMLElement.prototype) return
    return applyLegacyInertFallback(node)
  }, [inert, ref])
}

interface DemoBookingProps {
  /** Layout/placement classes (grid cell). Never chrome. */
  className?: string
}

/**
 * The demo page's right column: a two-step booking card and the only client
 * island on the page. Owns the card chrome and the step transition.
 *
 * The form (panel 1) and scheduler (panel 2) sit side by side in a sliding
 * track; submitting slides one-way to the scheduler at `duration-200 ease-out`.
 * The form stays mounted and drives the card height, so the card never resizes
 * across the transition; a `ResizeObserver` keeps the pinned height in sync as
 * the form grows (inline error, phone breakpoint). The off-screen panel is
 * `inert` (out of tab/AT order) and the scheduler lazy-mounts on submit,
 * preloaded on first form focus.
 *
 * The pin is published as the `--demo-card-h` CSS var (not an inline `height`)
 * so a `max-sm:h-[80svh]` class can override it once the scheduler shows — the
 * Cal booker needs a real viewport on phones instead of being crammed into the
 * short form height. `svh` keeps tap targets from shifting as the mobile URL bar
 * hides/shows.
 */
export function DemoBooking({ className }: DemoBookingProps) {
  const [lead, setLead] = useState<DemoLead | null>(null)
  const [formHeight, setFormHeight] = useState<number>()
  const formRef = useRef<HTMLDivElement>(null)
  const formPanelRef = useRef<HTMLDivElement>(null)
  const schedulerPanelRef = useRef<HTMLDivElement>(null)
  const showScheduler = lead !== null

  useLegacyInertFallback(formPanelRef, showScheduler)
  useLegacyInertFallback(schedulerPanelRef, !showScheduler)

  useEffect(() => {
    const node = formRef.current
    if (!node) return
    const measure = () => setFormHeight(node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-lg bg-[var(--surface-2)]',
        chipBorderShadowRing,
        'h-[var(--demo-card-h)]',
        showScheduler && 'max-sm:h-[80svh]',
        className
      )}
      style={{ '--demo-card-h': formHeight ? `${formHeight}px` : undefined } as CSSProperties}
    >
      <div
        className='flex h-full w-full transition-transform duration-200 ease-out motion-reduce:transition-none'
        style={{ transform: showScheduler ? 'translateX(-100%)' : undefined }}
      >
        <div
          ref={formPanelRef}
          className='w-full min-w-0 shrink-0'
          inert={showScheduler}
          onFocusCapture={() => void preloadScheduler()}
        >
          <div ref={formRef} className='p-6 max-sm:p-5'>
            <DemoForm onComplete={setLead} />
          </div>
        </div>
        <div
          ref={schedulerPanelRef}
          className='h-full w-full min-w-0 shrink-0'
          inert={!showScheduler}
        >
          {lead ? <DemoScheduler lead={lead} /> : null}
        </div>
      </div>
    </div>
  )
}
