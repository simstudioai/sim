import { getGooglePageLocation, updateGooglePageContext } from '@/lib/consent/google-context'
import { GOOGLE_ADS_ID, GOOGLE_ANALYTICS_ID } from '@/lib/consent/scripts'

/** Conversion labels registered in Google Ads, keyed by the action they measure. */
const GOOGLE_ADS_CONVERSION_LABELS = {
  demo_booked: 'Xt8wCK7b1e4cEL_Zk99C',
} as const

export type GoogleAdsConversion = keyof typeof GOOGLE_ADS_CONVERSION_LABELS

interface GoogleAnalyticsEventMap {
  sign_up: { method: string }
  get_a_demo: {
    page_path: '/demo'
    form_name: 'sim_demo'
    booking_status: 'scheduled'
  }
}

/** Sends an event only after the caller has verified measurement consent. */
export function trackGoogleEvent<E extends keyof GoogleAnalyticsEventMap>(
  name: E,
  parameters: GoogleAnalyticsEventMap[E]
): void {
  if (!getGooglePageLocation(window.location.href)) return
  updateGooglePageContext(window.location.href)
  window.gtag?.('event', name, { ...parameters, send_to: GOOGLE_ANALYTICS_ID })
}

/**
 * Records a Google Ads conversion, addressed as `<tag id>/<conversion label>`.
 * Call only after the caller has verified marketing consent, matching the
 * application's policy for explicitly sending conversion events.
 */
export function trackGoogleAdsConversion(conversion: GoogleAdsConversion): void {
  if (!getGooglePageLocation(window.location.href)) return
  updateGooglePageContext(window.location.href)
  window.gtag?.('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABELS[conversion]}`,
  })
}

export function trackGooglePageView(path: string): void {
  const url = new URL(window.location.href)
  url.pathname = path
  const pageLocation = getGooglePageLocation(url.href)
  if (!pageLocation) return

  updateGooglePageContext(pageLocation)
  window.gtag?.('event', 'page_view', {
    page_path: new URL(pageLocation).pathname,
    page_location: pageLocation,
    send_to: GOOGLE_ANALYTICS_ID,
  })
}
