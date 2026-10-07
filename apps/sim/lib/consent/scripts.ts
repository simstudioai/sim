import { ahrefsAnalytics } from '@c15t/scripts/ahrefs-analytics'
import { gtag } from '@c15t/scripts/google-tag'
import { FREEBUFF_TAG_SRC, installFreebuffStub } from '@/lib/analytics/freebuff'
import { getGooglePageLocation, updateGooglePageContext } from '@/lib/consent/google-context'

export const GOOGLE_ANALYTICS_ID = 'G-QB9D67TBHR' as const

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
const GOOGLE_ADS_ID = 'AW-17916292239' as const

const AHREFS_ANALYTICS_KEY = 'WJ9yWTBAiQKZAE/2TyU/yA' as const

const GOOGLE_ANALYTICS_SCRIPT = gtag({
  id: GOOGLE_ANALYTICS_ID,
  category: 'measurement',
})
export type ConsentScriptCallbackInfo = Parameters<
  NonNullable<typeof GOOGLE_ANALYTICS_SCRIPT.onBeforeLoad>
>[0]
const initializeGoogleAnalytics = GOOGLE_ANALYTICS_SCRIPT.onBeforeLoad

/** Consent-aware analytics that applies to both public and product routes. */
const GLOBAL_CONSENT_SCRIPTS = [
  {
    ...GOOGLE_ANALYTICS_SCRIPT,
    onBeforeLoad: (info: ConsentScriptCallbackInfo) => {
      const pageLocation = getGooglePageLocation(window.location.href)
      if (!pageLocation) return

      window.dataLayer ||= []
      window.gtag ||= (...args: unknown[]) => {
        window.dataLayer.push(args)
      }
      updateGooglePageContext(window.location.href, document.referrer)
      initializeGoogleAnalytics?.(info)
      window.gtag('config', GOOGLE_ADS_ID)
    },
  },
  ahrefsAnalytics({ key: AHREFS_ANALYTICS_KEY }),
  /**
   * Global rather than landing-only: the ad lands on a marketing page but the
   * conversion fires from `/signup`. The tag recovers `?bfcid=` from the
   * original navigation entry, so a client-side route change before consent
   * resolves does not lose the click id.
   */
  {
    id: 'freebuff-tag',
    src: FREEBUFF_TAG_SRC,
    category: 'marketing',
    async: true,
    onBeforeLoad: installFreebuffStub,
  },
] as const

/** Registers Google's shared destination only on Sim's actual production origins. */
export function getGlobalConsentScripts() {
  const googleEnabled =
    typeof window !== 'undefined' && getGooglePageLocation(window.location.href) !== undefined
  return GLOBAL_CONSENT_SCRIPTS.filter((script) => script.id !== 'gtag' || googleEnabled)
}
