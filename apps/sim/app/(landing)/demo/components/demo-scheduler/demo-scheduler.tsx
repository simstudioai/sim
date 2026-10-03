'use client'

import { useEffect } from 'react'
import Cal, { getCalApi } from '@calcom/embed-react'
import { useTheme } from 'next-themes'
import { trackGoogleAdsConversion, trackGoogleEvent } from '@/lib/analytics/google'
import { X_DEMO_BOOKED_EVENT_ID } from '@/lib/consent/scripts'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'
import type { DemoLead } from '@/app/(landing)/demo/components/demo-form'

const CAL_NAMESPACE = 'demo'
const DEFAULT_CAL_ORIGIN = 'https://app.cal.com'
const DEFAULT_CAL_LINK = 'team/sim/demo'

interface CalEmbedConfig {
  calLink: string
  calOrigin: string
  embedJsUrl: string
}

function parseCalEmbedConfig(link: string): CalEmbedConfig {
  const url = new URL(link.replace(/^\/+/, ''), `${DEFAULT_CAL_ORIGIN}/`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Cal link must use HTTP(S) without embedded credentials')
  }

  const calLink = `${url.pathname.replace(/^\/+/, '')}${url.search}`
  if (!calLink) throw new Error('Cal link must include an event path')

  return {
    calLink,
    calOrigin: url.origin,
    embedJsUrl: `${url.origin}/embed/embed.js`,
  }
}

/** Resolves the configured booker, falling back safely when the environment value is invalid. */
export function resolveCalEmbedConfig(configuredLink?: string): CalEmbedConfig {
  try {
    return parseCalEmbedConfig(configuredLink?.trim() || DEFAULT_CAL_LINK)
  } catch {
    return parseCalEmbedConfig(DEFAULT_CAL_LINK)
  }
}

const CAL_EMBED = resolveCalEmbedConfig(process.env.NEXT_PUBLIC_CAL_LINK)

/**
 * Sim's brand color, matching the `--brand-agent` token. The embed renders in a
 * cross-origin iframe, so it can't read our CSS vars - it needs the literal hex.
 */
const CAL_BRAND_COLOR = '#6f3dfa'

interface DemoSchedulerProps {
  /** The captured lead used to prefill the Cal.com booking. */
  lead: DemoLead
}

let calEmbedPreloaded = false

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
  getCalApi({ namespace: CAL_NAMESPACE, embedJsUrl: CAL_EMBED.embedJsUrl })
    .then((cal) => {
      cal('preload', { calLink: CAL_EMBED.calLink })
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
 * The embed follows the page's theme and carries Sim's brand color, and the
 * captured name/email/notes prefill the booking so the visitor never retypes. It
 * fills the panel (`flex-1`), which the parent sizes to the form's height, so the
 * card stays the same height across the form→calendar transition.
 */
export function DemoScheduler({ lead }: DemoSchedulerProps) {
  const { marketing, measurement } = useTrackingConsent()
  const { resolvedTheme } = useTheme()
  const calTheme = resolvedTheme === 'dark' ? 'dark' : 'light'

  useEffect(() => {
    let cancelled = false
    const trackDemoBooked = () => {
      if (measurement) {
        trackGoogleEvent('get_a_demo', {
          page_path: '/demo',
          form_name: 'sim_demo',
          booking_status: 'scheduled',
        })
      }
      if (marketing) {
        trackGoogleAdsConversion('demo_booked')
        window.twq?.('event', X_DEMO_BOOKED_EVENT_ID, {})
      }
    }
    const api = getCalApi({ namespace: CAL_NAMESPACE, embedJsUrl: CAL_EMBED.embedJsUrl })
    api
      .then((cal) => {
        if (cancelled) return
        cal('ui', {
          hideEventTypeDetails: true,
          theme: calTheme,
          styles: { branding: { brandColor: CAL_BRAND_COLOR } },
        })
        if (measurement || marketing) {
          cal('on', { action: 'bookingSuccessfulV2', callback: trackDemoBooked })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (!measurement && !marketing) return
      api
        .then((cal) => cal('off', { action: 'bookingSuccessfulV2', callback: trackDemoBooked }))
        .catch(() => {})
    }
  }, [calTheme, marketing, measurement])

  return (
    <div className='flex h-full min-w-0 flex-col p-6 max-sm:p-5'>
      <h2 className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Pick a time{lead.name ? `, ${lead.name}` : ''}
      </h2>
      <p className='mt-1.5 text-[var(--text-secondary)] text-sm'>
        Choose a slot that works for your team and we'll send a calendar invite.
      </p>
      <div className='mt-5 min-h-0 flex-1'>
        <Cal
          namespace={CAL_NAMESPACE}
          calLink={CAL_EMBED.calLink}
          calOrigin={CAL_EMBED.calOrigin}
          embedJsUrl={CAL_EMBED.embedJsUrl}
          className='size-full overflow-auto'
          config={{
            name: lead.name,
            email: lead.email,
            notes: lead.notes,
            theme: calTheme,
            'ui.color-scheme': calTheme,
            layout: 'month_view',
            useSlotsViewOnSmallScreen: 'true',
          }}
        />
      </div>
    </div>
  )
}
