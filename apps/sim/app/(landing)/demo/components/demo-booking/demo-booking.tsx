'use client'

import { type CSSProperties, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { chipBorderShadowRing } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { DemoForm, type DemoLead } from '@/app/(landing)/demo/components/demo-form'

const importScheduler = () => import('@/app/(landing)/demo/components/demo-scheduler')

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

interface DemoBookingProps {
  /** Layout/placement classes (grid cell). Never chrome. */
  className?: string
}

/**
 * The demo page's right column - a two-step booking card and the only client
 * island on the page. It owns the card chrome (`rounded-lg`, `--surface-2`,
 * {@link chipBorderShadowRing}) and the step.
 *
 * Both steps live side by side in a sliding track: the form is panel 1, the
 * scheduler panel 2. Submitting slides one-way to the scheduler
 * (`translateX(-100%)`) at the platform's `duration-200 ease-out` (a refresh
 * restarts the flow). The form stays mounted (it drives the card height); the
 * off-screen panel is `inert` so it's out of tab/AT order.
 *
 * The card is pinned to the form's measured height so it never resizes across
 * the form→calendar transition (the Cal embed self-sizes its own iframe via
 * postMessage, so this is purely to keep the card's height stable). A
 * `ResizeObserver` keeps it in sync as the form grows (an inline error, a phone
 * breakpoint). The scheduler fills its panel and lazy-mounts on submit (preloaded
 * on first form focus).
 *
 * Exception on phones (`max-sm`): once the scheduler is showing, the form-height
 * pin is overridden to `80svh` so the Cal booker gets a real viewport instead of
 * being crammed into the short form height - which caged the self-sizing iframe
 * behind `overflow:auto` and made its day/time slots tiny and hard to tap. The
 * pin is published as the `--demo-card-h` CSS var rather than an inline `height`
 * so the `max-sm` class can win (a media-query class can't override an inline
 * style height). `svh` keeps the height steady as the mobile URL bar shows/hides,
 * so the tap targets never shift.
 *
 * (Wiring the lead to a backend on submit slots in here - capture it before or
 * alongside `setLead`.)
 */
export function DemoBooking({ className }: DemoBookingProps) {
  const [lead, setLead] = useState<DemoLead | null>(null)
  const [formHeight, setFormHeight] = useState<number>()
  const formRef = useRef<HTMLDivElement>(null)
  const showScheduler = lead !== null

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
          className='w-full min-w-0 shrink-0'
          inert={showScheduler}
          onFocusCapture={() => void importScheduler()}
        >
          <div ref={formRef} className='p-6 max-sm:p-5'>
            <DemoForm onComplete={setLead} />
          </div>
        </div>
        <div className='h-full w-full min-w-0 shrink-0' inert={!showScheduler}>
          {lead ? <DemoScheduler lead={lead} /> : null}
        </div>
      </div>
    </div>
  )
}
