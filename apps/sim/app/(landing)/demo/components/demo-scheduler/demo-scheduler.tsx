'use client'

import { useEffect, useRef } from 'react'
import { trackGoogleEvent } from '@/lib/analytics/google'
import { X_DEMO_BOOKED_EVENT_ID } from '@/lib/consent/scripts'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'
import type { DemoLead } from '@/app/(landing)/demo/components/demo-form'
import {
  CAL_ORIGIN,
  createConfiguredCalUrl,
} from '@/app/(landing)/demo/components/demo-scheduler/cal-config'

const CAL_NAMESPACE = 'demo'

/** Sim's brand color, matching the `--brand-agent` token. */
const CAL_BRAND_COLOR = '#6f3dfa'

const CAL_IFRAME_READY_EVENT = `CAL:${CAL_NAMESPACE}:__iframeReady`
const CAL_BOOKING_SUCCESS_EVENT = `CAL:${CAL_NAMESPACE}:bookingSuccessfulV2`

interface DemoSchedulerProps {
  /** The captured lead used to prefill the Cal.com booking. */
  lead: DemoLead
}

interface CalMessage {
  fullType: string
}

let calPreloadFrame: HTMLIFrameElement | null = null

function isCalMessage(data: unknown): data is CalMessage {
  if (!data || typeof data !== 'object') return false
  return typeof Reflect.get(data, 'fullType') === 'string'
}

/**
 * Creates the same hosted booker URL the former Cal React wrapper generated.
 * Query parameters keep the lead prefill and light, month-view presentation.
 */
export function createCalEmbedUrl(lead: DemoLead): string {
  const url = createConfiguredCalUrl()
  const normalizedPath = url.pathname.replace(/\/+$/, '')
  url.pathname = normalizedPath.endsWith('/embed') ? normalizedPath : `${normalizedPath}/embed`
  url.searchParams.set('embed', CAL_NAMESPACE)
  url.searchParams.set('name', lead.name)
  url.searchParams.set('email', lead.email)
  url.searchParams.set('notes', lead.notes)
  url.searchParams.set('theme', 'light')
  url.searchParams.set('ui.color-scheme', 'light')
  url.searchParams.set('layout', 'month_view')
  url.searchParams.set('useSlotsViewOnSmallScreen', 'true')
  return url.toString()
}

function createCalPreloadUrl(): string {
  const url = createConfiguredCalUrl()
  url.searchParams.set('preload', 'true')
  return url.toString()
}

/**
 * Warms Cal.com's booker in a hidden hosted iframe on first form focus. The
 * frame remains mounted so its browser cache and connection stay available to
 * the visible scheduler. Repeat calls are idempotent; a failed navigation can
 * be retried by a later focus.
 */
export function preloadCalEmbed(): void {
  if (typeof document === 'undefined' || !document.body || calPreloadFrame?.isConnected) return

  const frame = document.createElement('iframe')
  calPreloadFrame = frame
  frame.src = createCalPreloadUrl()
  frame.hidden = true
  frame.tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')
  frame.addEventListener(
    'error',
    () => {
      frame.remove()
      if (calPreloadFrame === frame) calPreloadFrame = null
    },
    { once: true }
  )
  document.body.append(frame)
}

/**
 * Step 2 of the booking card - the hosted Cal.com scheduler, prefilled from the
 * form's {@link DemoLead}. It uses Cal's public iframe protocol directly, which
 * keeps the same booker while avoiding a client SDK in the landing bundle.
 *
 * The ready handshake applies the prior light theme, hidden event details, and
 * brand color. Booking-success messages are accepted only from this iframe and
 * Cal's expected origin before consent-aware analytics fire.
 */
export function DemoScheduler({ lead }: DemoSchedulerProps) {
  const { marketing, measurement } = useTrackingConsent()
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const frameWindow = frameRef.current?.contentWindow
      if (event.origin !== CAL_ORIGIN || !frameWindow || event.source !== frameWindow) return
      if (!isCalMessage(event.data)) return

      if (event.data.fullType === CAL_IFRAME_READY_EVENT) {
        frameWindow.postMessage({ originator: 'CAL', method: 'parentKnowsIframeReady' }, CAL_ORIGIN)
        frameWindow.postMessage(
          {
            originator: 'CAL',
            method: 'ui',
            arg: {
              hideEventTypeDetails: true,
              styles: { branding: { brandColor: CAL_BRAND_COLOR } },
            },
          },
          CAL_ORIGIN
        )
        return
      }

      if (event.data.fullType !== CAL_BOOKING_SUCCESS_EVENT) return
      if (measurement) {
        trackGoogleEvent('get_a_demo', {
          page_path: '/demo',
          form_name: 'sim_demo',
          booking_status: 'scheduled',
        })
      }
      if (marketing) window.twq?.('event', X_DEMO_BOOKED_EVENT_ID, {})
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [marketing, measurement])

  return (
    <div className='flex h-full min-w-0 flex-col p-6 max-sm:p-5'>
      <h2 className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Pick a time{lead.name ? `, ${lead.name}` : ''}
      </h2>
      <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
        Choose a slot that works for your team and we'll send a calendar invite.
      </p>
      <div className='mt-5 min-h-0 flex-1'>
        <iframe
          ref={frameRef}
          className='size-full border-0'
          src={createCalEmbedUrl(lead)}
          name={`cal-embed=${CAL_NAMESPACE}`}
          title='Book a demo'
        />
      </div>
    </div>
  )
}
