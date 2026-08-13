'use client'

import { useEffect } from 'react'
import Cal, { getCalApi } from '@calcom/embed-react'
import { isHosted } from '@/lib/core/config/env-flags'
import type { DemoLead } from '@/app/(landing)/demo/components/demo-form'

/** The Cal.com event the demo books - set `NEXT_PUBLIC_CAL_LINK` to override. */
const CAL_NAMESPACE = 'demo'
const CAL_LINK = process.env.NEXT_PUBLIC_CAL_LINK ?? 'team/sim/demo'

/**
 * Sim's brand color, matching the `--brand-agent` token. The embed renders in a
 * cross-origin iframe, so it can't read our CSS vars - it needs the literal hex.
 */
const CAL_BRAND_COLOR = '#6f3dfa'

/**
 * X (Twitter) conversion event fired when a demo is actually booked, so ad
 * delivery optimizes toward bookings rather than form submits.
 */
const X_DEMO_BOOKED_EVENT_ID = 'tw-q5xbl-q5xbn'

interface DemoSchedulerProps {
  /** The captured lead used to prefill the Cal.com booking. */
  lead: DemoLead
}

let calEmbedPreloaded = false

/**
 * Fires the X conversion once the Cal.com booking is confirmed. There is no
 * standalone confirmation page to drop the pixel snippet into — Cal renders the
 * "you're booked" state inside its cross-origin iframe — so the embed's
 * `bookingSuccessfulV2` event is the confirmation.
 *
 * Module-scope so the same function identity can be handed to both `on` and
 * `off`. `window.twq` is only defined where {@link LandingLayout} renders the
 * pixel base code, so the optional call is a second guard for the window
 * between mount and `uwt.js` finishing — the stub `twq` queues calls made
 * before the script loads and replays them.
 */
function trackDemoBooked(): void {
  window.twq?.('event', X_DEMO_BOOKED_EVENT_ID, {})
}

/**
 * Warm the Cal.com embed before the scheduler mounts. Loads `embed.js` and
 * issues the embed's `preload` instruction, which fetches the booker in a
 * hidden `?preload=true` iframe so its assets are already cached when the real
 * embed renders on submit. Without this, nothing Cal.com-related starts
 * downloading until the visitor presses Continue, which is why the calendar
 * used to take several seconds to appear. Idempotent — repeat calls no-op
 * while a warm-up is in flight or done, but a failed embed.js load resets the
 * flag so a later focus can retry.
 */
export function preloadCalEmbed(): void {
  if (calEmbedPreloaded) return
  calEmbedPreloaded = true
  getCalApi({ namespace: CAL_NAMESPACE })
    .then((cal) => {
      cal('preload', { calLink: CAL_LINK })
    })
    .catch(() => {
      calEmbedPreloaded = false
    })
}

/**
 * Step 2 of the booking card - the Cal.com scheduler, prefilled from the form's
 * {@link DemoLead}. Rendered inside the card chrome owned by {@link DemoBooking}
 * and lazy-loaded, so the embed script never touches the initial landing bundle.
 *
 * The embed is pinned to the page's light theme and Sim's brand color, and the
 * captured name/email/notes prefill the booking so the visitor never retypes. It
 * fills the panel (`flex-1`), which the parent sizes to the form's height, so the
 * card stays the same height across the form→calendar transition.
 */
export function DemoScheduler({ lead }: DemoSchedulerProps) {
  useEffect(() => {
    let cancelled = false
    const api = getCalApi({ namespace: CAL_NAMESPACE })
    api
      .then((cal) => {
        if (cancelled) return
        cal('ui', {
          hideEventTypeDetails: true,
          styles: { branding: { brandColor: CAL_BRAND_COLOR } },
        })
        // Matches the layout's pixel gating - a self-hosted deployment loads no
        // base pixel, so it must not subscribe an ad-tracking callback either.
        if (isHosted) cal('on', { action: 'bookingSuccessfulV2', callback: trackDemoBooked })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (!isHosted) return
      api
        .then((cal) => cal('off', { action: 'bookingSuccessfulV2', callback: trackDemoBooked }))
        .catch(() => {})
    }
  }, [])

  return (
    <div className='flex h-full min-w-0 flex-col p-6 max-sm:p-5'>
      <h2 className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Pick a time{lead.name ? `, ${lead.name}` : ''}
      </h2>
      <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
        Choose a slot that works for your team and we'll send a calendar invite.
      </p>
      <div className='mt-5 min-h-0 flex-1'>
        <Cal
          namespace={CAL_NAMESPACE}
          calLink={CAL_LINK}
          style={{ width: '100%', height: '100%', overflow: 'auto' }}
          config={{
            name: lead.name,
            email: lead.email,
            notes: lead.notes,
            theme: 'light',
            'ui.color-scheme': 'light',
            layout: 'month_view',
            useSlotsViewOnSmallScreen: 'true',
          }}
        />
      </div>
    </div>
  )
}
