import { getGooglePageLocation, updateGooglePageContext } from '@/lib/consent/google-context'
import { GOOGLE_ANALYTICS_ID } from '@/lib/consent/scripts'

interface GoogleAnalyticsEventMap {
  sign_up: { method: string }
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
