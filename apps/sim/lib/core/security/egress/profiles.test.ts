/**
 * @vitest-environment node
 *
 * Drives `resolveEgressPolicy` through the real profile table on both
 * deployment postures, so a change to `PROFILE_SPECS` or to the hosted gate is
 * visible here rather than only in whatever call site happens to notice.
 */

import { evaluateAddress, evaluateUrl } from '@sim/security/egress'
import { envFlagsMock, resetEnvFlagsMock } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  describeEgressDenial,
  type EgressProfile,
  resolveEgressPolicy,
} from '@/lib/core/security/egress/profiles'

afterEach(resetEnvFlagsMock)

const ALLOWLIST_PROFILES: EgressProfile[] = [
  'configuredEndpoint',
  'selfHostedService',
  'requestTarget',
  'databaseHost',
]
const LOCKED_PROFILES: EgressProfile[] = ['contentFetch', 'proxy']

function decide(profile: EgressProfile, href: string, address?: string) {
  const url = new URL(href)
  const policy = resolveEgressPolicy(profile)
  return address === undefined ? evaluateUrl(url, policy) : evaluateAddress(url, address, policy)
}

describe('the operator allowlist reaches exactly the provenances that honor it', () => {
  it.each(ALLOWLIST_PROFILES)('%s honors an allowlisted range', (profile) => {
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    expect(decide(profile, 'https://internal.corp/', '10.4.2.9').allowed).toBe(true)
  })

  it.each(LOCKED_PROFILES)('%s ignores it', (profile) => {
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    expect(decide(profile, 'https://internal.corp/', '10.4.2.9').allowed).toBe(false)
  })
})

describe('plain HTTP', () => {
  it('is unconditional for on-prem software off the hosted platform', () => {
    expect(decide('selfHostedService', 'http://vllm.corp/', '93.184.216.34').allowed).toBe(true)
  })

  it('needs the destination vouched for a configured endpoint', () => {
    expect(decide('configuredEndpoint', 'http://grafana.corp/', '93.184.216.34').allowed).toBe(
      false
    )
    envFlagsMock.egressAllowedHosts = 'grafana.corp'
    expect(decide('configuredEndpoint', 'http://grafana.corp/', '93.184.216.34').allowed).toBe(true)
  })

  it('is never available to content-provenance URLs', () => {
    envFlagsMock.egressAllowedHosts = 'cdn.corp'
    expect(decide('contentFetch', 'http://cdn.corp/x.png', '93.184.216.34').allowed).toBe(false)
  })
})

describe('the loopback carve-out', () => {
  it.each(['configuredEndpoint', 'selfHostedService', 'requestTarget'] as EgressProfile[])(
    '%s reaches loopback unasked off the hosted platform',
    (profile) => {
      expect(decide(profile, 'http://localhost:11434/', '127.0.0.1').allowed).toBe(true)
    }
  )

  it.each(['contentFetch', 'databaseHost', 'proxy'] as EgressProfile[])(
    '%s does not',
    (profile) => {
      expect(decide(profile, 'https://localhost/x', '127.0.0.1').allowed).toBe(false)
    }
  )
})

describe('the hosted platform ignores every softening', () => {
  it('drops the operator allowlist', () => {
    envFlagsMock.isHosted = true
    envFlagsMock.egressAllowedHosts = 'internal.corp'
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    for (const profile of ALLOWLIST_PROFILES) {
      expect(decide(profile, 'https://internal.corp/', '10.4.2.9').allowed).toBe(false)
    }
  })

  it('drops the loopback carve-out', () => {
    envFlagsMock.isHosted = true
    expect(decide('configuredEndpoint', 'https://localhost/x', '127.0.0.1').allowed).toBe(false)
  })

  it('caps plain HTTP, which is a self-hosted arrangement', () => {
    envFlagsMock.isHosted = true
    expect(decide('selfHostedService', 'http://vllm.example/', '93.184.216.34').allowed).toBe(false)
    expect(decide('proxy', 'http://proxy.example/', '93.184.216.34').allowed).toBe(false)
  })

  it('offers no remedy in the refusal, where the variables would do nothing', () => {
    envFlagsMock.isHosted = true
    const decision = decide('requestTarget', 'https://internal.corp/', '10.4.2.9')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(describeEgressDenial(decision, 'url', 'requestTarget')).not.toContain('EGRESS_ALLOWED')
  })
})

describe('the deprecated ALLOW_PRIVATE_DATABASE_HOSTS', () => {
  it('reaches database hosts only', () => {
    envFlagsMock.legacyPrivateDatabaseAccess = true
    expect(decide('databaseHost', 'https://pg.corp/', '10.4.2.9').allowed).toBe(true)
    expect(decide('configuredEndpoint', 'https://pg.corp/', '10.4.2.9').allowed).toBe(false)
  })

  it('still cannot reach a metadata endpoint', () => {
    envFlagsMock.legacyPrivateDatabaseAccess = true
    expect(decide('databaseHost', 'https://pg.corp/', '169.254.169.254').allowed).toBe(false)
  })
})

describe('an unrecognized profile falls back to the strictest one', () => {
  it('refuses what contentFetch refuses', () => {
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    const policy = resolveEgressPolicy('not-a-profile' as EgressProfile)
    expect(evaluateAddress(new URL('https://internal.corp/'), '10.4.2.9', policy).allowed).toBe(
      false
    )
  })
})

describe('the policy cache follows the configuration', () => {
  it('rebuilds when an allowlist changes rather than serving the previous value', () => {
    expect(decide('requestTarget', 'https://internal.corp/', '10.4.2.9').allowed).toBe(false)
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    expect(decide('requestTarget', 'https://internal.corp/', '10.4.2.9').allowed).toBe(true)
  })
})
