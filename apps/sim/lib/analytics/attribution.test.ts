/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAttributionCookies,
  formatAttributionForNotification,
  readAttributionProperties,
  recordAttributionTouch,
} from '@/lib/analytics/attribution'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const LATER = new Date('2026-10-09T12:00:00.000Z')

/** Reads the raw, still URL-encoded value, as a request's `Cookie` header carries it. */
function readBrowserCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function recordedProperties() {
  return readAttributionProperties(readBrowserCookie)
}

/** A request whose first-touch cookie holds `raw` and whose last-touch cookie is absent. */
function firstTouchCookie(raw: string) {
  return (name: string) => (name === 'sim_attribution_first' ? raw : undefined)
}

beforeEach(() => {
  clearAttributionCookies()
})

describe('recordAttributionTouch', () => {
  it.each([
    [
      'an SSO identity provider bounce back to login',
      'https://www.sim.ai/login',
      'https://acme.okta.com/',
    ],
    ['a payment provider return', 'https://www.sim.ai/pricing', 'https://checkout.stripe.com/'],
    ['navigation inside the site', 'https://www.sim.ai/demo', 'https://www.sim.ai/pricing'],
    ['the apex redirect into www', 'https://www.sim.ai/', 'https://sim.ai/'],
    ['a direct visit', 'https://www.sim.ai/', ''],
    [
      'an external referral into the signed-in app',
      'https://www.sim.ai/home',
      'https://news.ycombinator.com/',
    ],
    ['an unparseable location', 'not a url', 'https://news.ycombinator.com/'],
    [
      "a customer's campaign link to their deployed chat",
      'https://www.sim.ai/chat/acme-support?utm_source=acme_newsletter',
      '',
    ],
    [
      'a campaign link to a shared file',
      'https://www.sim.ai/f/share-token-123?utm_medium=email',
      '',
    ],
  ])('records nothing for %s', (_case, href, referrer) => {
    recordAttributionTouch({ href, referrer, now: NOW })

    expect(recordedProperties()).toEqual({})
  })

  it('records an external referral as its hostname only', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/comparisons/n8n',
      referrer: 'https://news.ycombinator.com/item?id=42',
      now: NOW,
    })

    expect(recordedProperties()).toMatchObject({
      first_touch_referring_domain: 'news.ycombinator.com',
      first_touch_landing_path: '/comparisons/n8n',
      first_touch_touched_at: NOW.toISOString(),
    })
  })

  it('records campaign parameters on any path without keeping the rest of the query', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/signup?utm_source=newsletter&utm_medium=email&email=jane%40acme.com',
      referrer: 'https://accounts.google.com/',
      now: NOW,
    })

    const properties = recordedProperties()
    expect(properties).toEqual({
      first_touch_utm_source: 'newsletter',
      first_touch_utm_medium: 'email',
      first_touch_landing_path: '/signup',
      first_touch_touched_at: NOW.toISOString(),
      last_touch_utm_source: 'newsletter',
      last_touch_utm_medium: 'email',
      last_touch_landing_path: '/signup',
      last_touch_touched_at: NOW.toISOString(),
    })
    expect(document.cookie).not.toContain('acme.com')
  })

  it('records which ad network clicked through but never the click id itself', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/?gclid=Cj0KCQ-secret-click-id',
      referrer: 'https://www.google.com/',
      now: NOW,
    })

    expect(recordedProperties()).toMatchObject({
      first_touch_click_id_type: 'gclid',
      first_touch_referring_domain: 'www.google.com',
    })
    expect(document.cookie).not.toContain('secret-click-id')
  })

  it('keeps the first touch and replaces only the last touch on a later visit', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/?utm_source=youtube',
      referrer: '',
      now: NOW,
    })
    recordAttributionTouch({
      href: 'https://www.sim.ai/pricing',
      referrer: 'https://www.linkedin.com/',
      now: LATER,
    })

    expect(recordedProperties()).toMatchObject({
      first_touch_utm_source: 'youtube',
      first_touch_touched_at: NOW.toISOString(),
      last_touch_referring_domain: 'www.linkedin.com',
      last_touch_touched_at: LATER.toISOString(),
    })
    expect(recordedProperties()).not.toHaveProperty('last_touch_utm_source')
  })

  it('never lets a referral from another Sim site replace a real last touch', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/?utm_source=linkedin',
      referrer: '',
      now: NOW,
    })
    recordAttributionTouch({
      href: 'https://www.sim.ai/pricing',
      referrer: 'https://docs.sim.ai/introduction',
      now: LATER,
    })

    expect(recordedProperties()).toMatchObject({
      last_touch_utm_source: 'linkedin',
      last_touch_touched_at: NOW.toISOString(),
    })
  })

  it('still credits another Sim site when it is the only source', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/pricing',
      referrer: 'https://docs.sim.ai/introduction',
      now: NOW,
    })

    expect(recordedProperties()).toMatchObject({
      first_touch_referring_domain: 'docs.sim.ai',
      last_touch_referring_domain: 'docs.sim.ai',
    })
  })

  it('repairs a first-touch cookie that no longer parses', () => {
    document.cookie = 'sim_attribution_first=%7Btruncated; Path=/'

    recordAttributionTouch({
      href: 'https://www.sim.ai/?utm_source=youtube',
      referrer: '',
      now: NOW,
    })

    expect(recordedProperties()).toMatchObject({ first_touch_utm_source: 'youtube' })
  })

  it('keeps a touch far below the cookie size limit whatever script a link carries', () => {
    const wide = encodeURIComponent('"漢字"'.repeat(1000))
    recordAttributionTouch({
      href: `https://www.sim.ai/?utm_campaign=${wide}&utm_content=${wide}&utm_term=${wide}&utm_source=${wide}`,
      referrer: '',
      now: NOW,
    })

    const stored = readBrowserCookie('sim_attribution_first')
    expect(stored).toBeDefined()
    expect(stored?.length).toBeLessThan(2048)
  })

  it('writes nothing once the consent grant it would be recorded under has lapsed', () => {
    recordAttributionTouch({
      href: 'https://www.sim.ai/?utm_source=youtube',
      referrer: '',
      now: NOW,
      consentExpiresAt: NOW.getTime() - 1,
    })

    expect(recordedProperties()).toEqual({})
  })

  it('bounds attacker-sized campaign values', () => {
    recordAttributionTouch({
      href: `https://www.sim.ai/?utm_campaign=${'x'.repeat(5000)}`,
      referrer: '',
      now: NOW,
    })

    expect(recordedProperties().first_touch_utm_campaign).toHaveLength(100)
  })
})

describe('readAttributionProperties', () => {
  const touch = {
    utm_source: 'linkedin',
    utm_campaign: 'q4 agents & governance',
    referring_domain: 'www.linkedin.com',
    landing_path: '/enterprise',
    touched_at: NOW.toISOString(),
  }
  const expected = {
    first_touch_utm_source: 'linkedin',
    first_touch_utm_campaign: 'q4 agents & governance',
    first_touch_referring_domain: 'www.linkedin.com',
    first_touch_landing_path: '/enterprise',
    first_touch_touched_at: NOW.toISOString(),
  }

  it('reads a cookie value whether or not the cookie layer already URL-decoded it', () => {
    const decoded = JSON.stringify(touch)

    expect(readAttributionProperties(firstTouchCookie(decoded))).toEqual(expected)
    expect(readAttributionProperties(firstTouchCookie(encodeURIComponent(decoded)))).toEqual(
      expected
    )
  })

  it.each([
    ['non-JSON', 'utm_source=google'],
    ['a JSON array', '[]'],
    [
      'a non-string landing path',
      JSON.stringify({ landing_path: 5, touched_at: NOW.toISOString() }),
    ],
    [
      'a landing path that is not a path',
      JSON.stringify({ landing_path: 'https://evil.example/', touched_at: NOW.toISOString() }),
    ],
    ['an invalid timestamp', JSON.stringify({ landing_path: '/', touched_at: 'yesterday' })],
  ])('ignores a cookie holding %s', (_case, raw) => {
    expect(readAttributionProperties(firstTouchCookie(raw))).toEqual({})
  })

  it('keeps a tampered landing path to its path and drops a referrer that is not a hostname', () => {
    const tampered = JSON.stringify({
      landing_path: '/demo?email=jane%40acme.com#top',
      touched_at: NOW.toISOString(),
      referring_domain: 'https://evil.example/?q=1',
    })

    expect(readAttributionProperties(firstTouchCookie(tampered))).toEqual({
      first_touch_landing_path: '/demo',
      first_touch_touched_at: NOW.toISOString(),
    })
  })

  it('drops unknown keys and clamps oversized values from a tampered cookie', () => {
    const tampered = JSON.stringify({
      landing_path: '/',
      touched_at: NOW.toISOString(),
      utm_source: 'y'.repeat(5000),
      utm_medium: 'cpc\r\nPriority: urgent',
      $set: { plan: 'enterprise' },
    })

    expect(readAttributionProperties(firstTouchCookie(tampered))).toEqual({
      first_touch_landing_path: '/',
      first_touch_touched_at: NOW.toISOString(),
      first_touch_utm_source: 'y'.repeat(100),
      first_touch_utm_medium: 'cpcPriority: urgent',
    })
  })
})

describe('formatAttributionForNotification', () => {
  it('cannot be made to forge extra lines in the notification', () => {
    const tampered = JSON.stringify({
      landing_path: '/',
      touched_at: NOW.toISOString(),
      utm_source: 'google\nLast touch: utm_source=forged\u2028Last touch: utm_medium=forged\u0085x',
    })

    expect(
      formatAttributionForNotification(firstTouchCookie(tampered)).split(/[\n\r\u0085\u2028\u2029]/)
    ).toHaveLength(1)
  })
})
