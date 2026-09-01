/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ConsentScriptCallbackInfo,
  GLOBAL_CONSENT_SCRIPTS,
  HUBSPOT_SCRIPT,
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
  window._hsq = []
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

  it('keeps landing vendors in separate consent categories', () => {
    expect(HUBSPOT_SCRIPT).toMatchObject({ id: 'hubspot', category: 'measurement' })
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

  it('gives HubSpot a query-free path before its automatic first page view', () => {
    window.history.replaceState({}, '', '/demo?email=private@example.com#booking')
    window._hsq = []

    HUBSPOT_SCRIPT.onBeforeLoad()

    expect(window._hsq).toEqual([['setPath', '/demo']])
  })
})
