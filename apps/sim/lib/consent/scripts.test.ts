/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai","referrer":"https://example.com/referral?email=private@example.com#secret"}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  trackGoogleAdsConversion,
  trackGoogleEvent,
  trackGooglePageView,
} from '@/lib/analytics/google'
import { getGooglePageLocation } from '@/lib/consent/google-context'
import {
  type ConsentScriptCallbackInfo,
  GOOGLE_ADS_ID,
  GOOGLE_ANALYTICS_ID,
  getGlobalConsentScripts,
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

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  document.title = 'Sim'
})

afterEach(() => {
  window.dataLayer = []
  Reflect.deleteProperty(window, 'gtag')
  window.history.replaceState({}, '', '/')
})

describe('consent scripts', () => {
  it('preserves campaign attribution while removing private parameters from the Google page context', () => {
    window.history.replaceState(
      {},
      '',
      '/signup?utm_source=google&utm_medium=cpc&utm_campaign=agents&gclid=click-id&email=private@example.com&token=secret#account'
    )
    window.dataLayer = []
    Reflect.deleteProperty(window, 'gtag')

    getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)

    expect(window.dataLayer[0]).toEqual([
      'set',
      expect.objectContaining({
        page_location: `${window.location.origin}/signup?utm_source=google&utm_medium=cpc&utm_campaign=agents&gclid=click-id`,
      }),
    ])
  })

  it('removes query parameters and fragments from the initial Google page context', () => {
    window.history.replaceState({}, '', '/signup?email=private@example.com#account')
    window.dataLayer = []
    Reflect.deleteProperty(window, 'gtag')

    getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)

    expect(window.dataLayer[0]).toEqual([
      'set',
      expect.objectContaining({ page_location: `${window.location.origin}/signup` }),
    ])
  })

  it.each(['https://sim.ai', 'https://www.sim.ai'])(
    'accepts the official production origin %s',
    (origin) => {
      expect(getGooglePageLocation(`${origin}/library`)).toBe(`${origin}/library`)
    }
  )

  it.each([
    'https://sim.ai.evil.example/',
    'https://evil.example/?url=https://www.sim.ai',
    'https://staging.sim.ai/',
    'https://dev.sim.ai/',
    'https://www.sim.ai:8443/',
    'http://www.sim.ai/',
    'http://localhost:3000/',
    'https://self-hosted.example/',
    'not a URL',
  ])('rejects collection from an unapproved origin %s', (url) => {
    expect(getGooglePageLocation(url)).toBeUndefined()
  })

  it('does not register the Google loader outside a production build', () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(getGlobalConsentScripts().some((script) => script.id === 'gtag')).toBe(false)
    expect(getGooglePageLocation('https://www.sim.ai/library')).toBeUndefined()
  })

  it('keeps supported campaign parameters and removes unknown parameters and fragments', () => {
    expect(
      getGooglePageLocation(
        'https://www.sim.ai/?utm_source=google&utm_medium=cpc&utm_campaign=agents&utm_id=123&utm_term=automation&utm_content=hero&gclid=g&dclid=d&gbraid=b&wbraid=w&token=secret&email=private@example.com#secret'
      )
    ).toBe(
      'https://www.sim.ai/?utm_source=google&utm_medium=cpc&utm_campaign=agents&utm_id=123&utm_term=automation&utm_content=hero&gclid=g&dclid=d&gbraid=b&wbraid=w'
    )
  })

  it.each([
    ['/workspace/workspace-id/w/workflow-id', '/workspace'],
    ['/workspace/workspace-id/knowledge/kb-id/document-id', '/workspace'],
    ['/workspace/workspace-id/files/file-id', '/workspace'],
    ['/workspace/workspace-id/tables/table-id', '/workspace'],
    ['/o/org-id/chat/chat-id', '/o'],
    ['/chat/customer-identifier', '/chat'],
    ['/resume/workflow-id/execution-id/context-id', '/resume'],
    ['/invite/invitation-id', '/invite'],
    ['/unsubscribe/token', '/unsubscribe'],
    ['/f/share-token', '/f'],
    ['/w/workflow-id', '/w'],
    ['/account/settings/privacy', '/account'],
    ['/selfhost/settings/general', '/selfhost'],
    ['/slack-search/connect/signed-token', '/slack-search'],
    ['/slack-search/install/team-id', '/slack-search'],
    ['/credential-groups/enroll/signed-token', '/credential-groups/enroll'],
    ['/enterprise/claim/signed-token', '/enterprise/claim'],
    ['/%66/share-token', '/f'],
    ['/%77orkspace/workspace-id/w/workflow-id', '/workspace'],
  ])('removes resource IDs and access tokens from %s', (path, expected) => {
    expect(getGooglePageLocation(`https://www.sim.ai${path}?utm_source=google&secret=token`)).toBe(
      `https://www.sim.ai${expected}?utm_source=google`
    )
  })

  it('uses grouped paths for the page-view path and later referral context', () => {
    window.history.replaceState({}, '', '/f/share-token?secret=value')
    getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)
    window.history.pushState({}, '', '/workspace/workspace-id/files/file-id')
    trackGooglePageView('/workspace/workspace-id/files/file-id')

    expect(window.dataLayer).toContainEqual([
      'event',
      'page_view',
      {
        page_path: '/workspace',
        page_location: 'https://www.sim.ai/workspace',
        send_to: GOOGLE_ANALYTICS_ID,
      },
    ])
    expect(window.dataLayer.filter((row) => Array.isArray(row) && row[0] === 'set').at(-1)).toEqual(
      ['set', expect.objectContaining({ page_referrer: 'https://www.sim.ai/f' })]
    )
  })

  it('keeps signup and Ads conversion context current after a virtual navigation', () => {
    window.history.replaceState({}, '', '/?utm_source=google')
    getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)
    window.history.pushState({}, '', '/signup?utm_campaign=agents&token=secret')
    document.title = 'Sign up — Sim'

    trackGooglePageView('/signup')
    trackGoogleEvent('sign_up', { method: 'email' })
    trackGoogleAdsConversion('demo_booked')

    expect(window.dataLayer.filter((row) => Array.isArray(row) && row[0] === 'set').at(-1)).toEqual(
      [
        'set',
        {
          page_location: 'https://www.sim.ai/signup?utm_campaign=agents',
          page_referrer: 'https://www.sim.ai/?utm_source=google',
          page_title: 'Sign up — Sim',
        },
      ]
    )
    expect(window.dataLayer).toContainEqual([
      'event',
      'sign_up',
      { method: 'email', send_to: GOOGLE_ANALYTICS_ID },
    ])
    expect(window.dataLayer).toContainEqual([
      'event',
      'conversion',
      expect.objectContaining({ send_to: `${GOOGLE_ADS_ID}/Xt8wCK7b1e4cEL_Zk99C` }),
    ])
    expect(
      window.dataLayer.filter(
        (row) => Array.isArray(row) && row[0] === 'event' && row[1] === 'page_view'
      )
    ).toHaveLength(1)
  })

  it('uses the preceding sanitized virtual page as the referrer without changing it for same-page events', () => {
    window.history.replaceState({}, '', '/library?utm_source=google&email=private@example.com')
    getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)
    expect(window.dataLayer[0]).toEqual([
      'set',
      expect.objectContaining({ page_referrer: 'https://example.com/' }),
    ])

    window.history.pushState({}, '', '/pricing?secret=token')
    trackGooglePageView('/pricing')
    window.history.pushState({}, '', '/demo?token=secret#account')
    trackGooglePageView('/demo')
    trackGoogleEvent('get_a_demo', {
      page_path: '/demo',
      form_name: 'sim_demo',
      booking_status: 'scheduled',
    })

    expect(window.dataLayer.filter((row) => Array.isArray(row) && row[0] === 'set').at(-1)).toEqual(
      [
        'set',
        expect.objectContaining({
          page_location: 'https://www.sim.ai/demo',
          page_referrer: 'https://www.sim.ai/pricing',
        }),
      ]
    )
  })

  it.each([
    '/workspace/workspace-id/knowledge/kb/document',
    '/o/org-id/settings',
    '/chat/customer-chat',
    '/f/customer-form',
  ])(
    'does not transmit a user-defined title from %s in the initial or virtual page context',
    (path) => {
      window.history.replaceState({}, '', path)
      document.title = 'Private acquisition plan for private@example.com'
      getGlobalConsentScripts()[0]?.onBeforeLoad?.(CALLBACK_INFO)
      expect(window.dataLayer[0]).toEqual(['set', expect.objectContaining({ page_title: 'Sim' })])

      window.history.pushState({}, '', '/workspace/other-workspace-id/home')
      trackGooglePageView('/workspace/other-workspace-id/home')
      expect(
        window.dataLayer.filter((row) => Array.isArray(row) && row[0] === 'set').at(-1)
      ).toEqual(['set', expect.objectContaining({ page_title: 'Sim' })])
    }
  )
})
