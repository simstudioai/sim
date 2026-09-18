/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ConsentScriptCallbackInfo,
  GLOBAL_CONSENT_SCRIPTS,
  GOOGLE_ADS_ID,
  GOOGLE_ANALYTICS_ID,
  X_PIXEL_SCRIPT,
} from '@/lib/consent/scripts'

const CALLBACK_INFO: ConsentScriptCallbackInfo = {
  id: 'test-script',
  elementId: 'test-script',
  hasConsent: false,
  consents: {
    necessary: true,
    functionality: false,
    experience: false,
    measurement: false,
    marketing: false,
  },
}

afterEach(() => {
  window.dataLayer = []
  window.gtag = undefined
  window.history.replaceState({}, '', '/')
})

describe('consent scripts', () => {
  it('loads global analytics through c15t with the intended categories', () => {
    expect(GLOBAL_CONSENT_SCRIPTS).toEqual([
      expect.objectContaining({
        id: 'gtag',
        category: 'measurement',
        alwaysLoad: true,
        persistAfterConsentRevoked: true,
        src: 'https://www.googletagmanager.com/gtag/js?id=G-DR7YBE70VS',
      }),
      expect.objectContaining({
        id: 'ahrefs-analytics',
        category: 'measurement',
        src: 'https://analytics.ahrefs.com/analytics.js',
      }),
    ])
  })

  it('gates the landing conversion pixel on marketing consent', () => {
    expect(X_PIXEL_SCRIPT).toMatchObject({
      id: 'x-pixel',
      category: 'marketing',
      src: 'https://static.ads-twitter.com/uwt.js',
    })
  })

  it('removes query parameters and fragments from the initial Google page context', () => {
    window.history.replaceState({}, '', '/signup?email=private@example.com#account')
    window.dataLayer = []
    window.gtag = undefined

    GLOBAL_CONSENT_SCRIPTS[0].onBeforeLoad?.(CALLBACK_INFO)

    expect(window.dataLayer[0]).toEqual([
      'set',
      { page_location: `${window.location.origin}/signup` },
    ])
  })

  it('configures Google Ads on the GA4 loader instead of a second gtag script', () => {
    window.dataLayer = []
    window.gtag = undefined

    GLOBAL_CONSENT_SCRIPTS[0].onBeforeLoad?.(CALLBACK_INFO)

    const configuredIds = window.dataLayer
      .filter((entry): entry is [string, string] => Array.isArray(entry) && entry[0] === 'config')
      .map(([, id]) => id)

    expect(configuredIds).toEqual([GOOGLE_ANALYTICS_ID, GOOGLE_ADS_ID])
    expect(GLOBAL_CONSENT_SCRIPTS.map((script) => script.src)).not.toContain(
      `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`
    )
  })
})
