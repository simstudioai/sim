import { GOOGLE_ANALYTICS_ID } from '@/lib/consent/scripts'

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
  window.gtag?.('event', name, parameters)
}

export function trackGooglePageView(path: string): void {
  window.gtag?.('event', 'page_view', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    send_to: GOOGLE_ANALYTICS_ID,
  })
}
