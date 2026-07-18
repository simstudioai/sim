import { describe, expect, it } from 'vitest'
import { getRegistrableDomain, originsShareCookieDomain } from '@/lib/apps/origin'

describe('app origin PSL isolation', () => {
  it('treats sibling subdomains as sharing a cookie domain', () => {
    expect(originsShareCookieDomain('https://apps.example.com', 'https://sim.example.com')).toBe(
      true
    )
  })

  it('allows distinct registrable domains', () => {
    expect(
      originsShareCookieDomain('https://apps.example-apps.com', 'https://sim.example.com')
    ).toBe(false)
  })

  it('allows distinct *.localhost hosts (local two-host recipe)', () => {
    // tldts may treat *.localhost as its own domain label; host-only cookie rule still applies.
    expect(getRegistrableDomain('http://apps.localhost:3005')).toBeTruthy()
    expect(
      originsShareCookieDomain('http://apps.localhost:3005', 'http://sim.localhost:3000')
    ).toBe(false)
  })

  it('rejects the same localhost hostname even on different ports', () => {
    expect(originsShareCookieDomain('http://localhost:3005', 'http://localhost:3000')).toBe(true)
  })

  it('isolates bare localhost vs a real domain', () => {
    expect(originsShareCookieDomain('http://localhost:3005', 'https://sim.example.com')).toBe(false)
  })
})
