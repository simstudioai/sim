/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { type ConsentScriptCallbackInfo, GLOBAL_CONSENT_SCRIPTS } from '@/lib/consent/scripts'

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
})
