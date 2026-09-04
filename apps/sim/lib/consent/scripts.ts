import { ahrefsAnalytics } from '@c15t/scripts/ahrefs-analytics'
import { gtag } from '@c15t/scripts/google-tag'
import { xPixel } from '@c15t/scripts/x-pixel'

export const GOOGLE_ANALYTICS_ID = 'G-DR7YBE70VS' as const

/**
 * Google Ads conversion tag. It rides the GA4 loader as a second `config`
 * destination rather than a second `gtag/js` script, which is Google's
 * documented pattern for sending one page to multiple Google products: a
 * second loader would re-run the same library, and c15t derives a script's
 * element id from the vendor name, so both entries would collide on `gtag`.
 *
 * Consent stays correct without a second consent category. The tag is loaded
 * under Consent Mode v2, where `ad_storage`, `ad_user_data`, and
 * `ad_personalization` are already mapped to the `marketing` category, so a
 * visitor who accepts measurement but declines marketing gets a cookieless
 * ping rather than conversion tracking.
 */
export const GOOGLE_ADS_ID = 'AW-17916292239' as const
export const X_PIXEL_ID = 'q5xbl' as const
export const X_DEMO_BOOKED_EVENT_ID = 'tw-q5xbl-q5xbn' as const

const AHREFS_ANALYTICS_KEY = 'WJ9yWTBAiQKZAE/2TyU/yA' as const

declare global {
  interface Window {
    _hsq?: unknown[][]
  }
}

const GOOGLE_ANALYTICS_SCRIPT = gtag({
  id: GOOGLE_ANALYTICS_ID,
  category: 'measurement',
})
export type ConsentScriptCallbackInfo = Parameters<
  NonNullable<typeof GOOGLE_ANALYTICS_SCRIPT.onBeforeLoad>
>[0]
const initializeGoogleAnalytics = GOOGLE_ANALYTICS_SCRIPT.onBeforeLoad

function withoutQueryOrHash(value: string): string | undefined {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
}

/** Consent-aware analytics that applies to both public and product routes. */
export const GLOBAL_CONSENT_SCRIPTS = [
  {
    ...GOOGLE_ANALYTICS_SCRIPT,
    onBeforeLoad: (info: ConsentScriptCallbackInfo) => {
      window.dataLayer ||= []
      window.gtag ||= (...args: unknown[]) => {
        window.dataLayer.push(args)
      }
      const referrer = document.referrer ? withoutQueryOrHash(document.referrer) : undefined
      window.gtag('set', {
        page_location: `${window.location.origin}${window.location.pathname}`,
        ...(referrer ? { page_referrer: referrer } : {}),
      })
      initializeGoogleAnalytics?.(info)
      window.gtag('config', GOOGLE_ADS_ID)
    },
  },
  ahrefsAnalytics({ key: AHREFS_ANALYTICS_KEY }),
] as const

/** Marketing-page integrations that should not load on a direct workspace visit. */
export const X_PIXEL_SCRIPT = xPixel({ pixelId: X_PIXEL_ID })

/** HubSpot has no first-party c15t helper, so it uses the generic script contract. */
export const HUBSPOT_SCRIPT = {
  id: 'hubspot',
  src: 'https://js-na2.hs-scripts.com/246720681.js',
  category: 'measurement',
  async: true,
  onBeforeLoad: () => {
    window._hsq ||= []
    window._hsq.push(['setPath', window.location.pathname])
  },
} as const
