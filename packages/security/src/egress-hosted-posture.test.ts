/**
 * @vitest-environment node
 *
 * Pins what the hosted platform permits. Everything here is a value comparison
 * against a policy built for isHosted=true, so it needs no module mocking.
 */

import { createEgressPolicy, evaluateAddress } from '@sim/security/egress'
import { describe, expect, it } from 'vitest'

/** Every profile collapses to this on hosted: no allowlist, no loopback, no private. */
const publicApi = createEgressPolicy({ insecureHttp: 'whenVouched' })
/** ...except the self-hosted-service profile, which still tolerates plain HTTP. */
const selfHostedService = createEgressPolicy({ insecureHttp: 'always' })

function decide(policy: Parameters<typeof evaluateAddress>[2], href: string, address: string) {
  return evaluateAddress(new URL(href), address, policy)
}

describe('hosted platform', () => {
  it.each([
    ['https://x.example/', '10.0.0.5', 'RFC1918'],
    ['https://x.example/', '127.0.0.1', 'loopback'],
    ['https://x.example/', '169.254.169.254', 'metadata'],
    ['https://x.example/', '192.168.1.1', 'RFC1918'],
  ])('refuses %s resolving to %s — %s', (href, address) => {
    expect(decide(publicApi, href, address).allowed).toBe(false)
    expect(decide(selfHostedService, href, address).allowed).toBe(false)
  })

  it('refuses a service port on a public host', () => {
    expect(decide(publicApi, 'https://x.example:5432/', '93.184.216.34').allowed).toBe(false)
    expect(decide(selfHostedService, 'http://x.example:5432/', '93.184.216.34').allowed).toBe(false)
  })

  it('permits ordinary public HTTPS', () => {
    expect(decide(publicApi, 'https://x.example/', '93.184.216.34').allowed).toBe(true)
  })

  it('keeps plain HTTP available only to the self-hosted-service profile', () => {
    expect(decide(publicApi, 'http://x.example/', '93.184.216.34').allowed).toBe(false)
    expect(decide(selfHostedService, 'http://x.example/', '93.184.216.34').allowed).toBe(true)
  })
})
