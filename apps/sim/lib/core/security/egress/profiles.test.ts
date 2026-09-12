/**
 * @vitest-environment node
 *
 * Drives `resolveEgressPolicy` through the real profile table on both
 * deployment postures, so a change to `PROFILE_SPECS` or to the hosted gate is
 * visible here rather than only in whatever call site happens to notice.
 */

import { evaluateAddress, evaluateUrl } from '@sim/security/egress'
import { envFlagsMock, resetEnvFlagsMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  describeEgressDenial,
  type EgressProfile,
  resolveEgressPolicy,
} from '@/lib/core/security/egress/profiles'

afterEach(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

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

const OPERATOR_MODEL_ENDPOINTS = [
  ['OLLAMA_URL', 'selfHostedService'],
  ['VLLM_BASE_URL', 'selfHostedService'],
  ['LITELLM_BASE_URL', 'selfHostedService'],
  ['AZURE_OPENAI_ENDPOINT', 'configuredEndpoint'],
  ['AZURE_ANTHROPIC_ENDPOINT', 'configuredEndpoint'],
  ['OCR_AZURE_ENDPOINT', 'configuredEndpoint'],
] as const

describe('operator-configured model endpoints', () => {
  it.each(OPERATOR_MODEL_ENDPOINTS)('%s trusts its exact host only in %s', (setting, profile) => {
    setEnv({ [setting]: 'http://model-service:11434/v1' })
    expect(decide(profile, 'http://model-service:11434/v1/models', '10.4.2.9').allowed).toBe(true)
    expect(decide(profile, 'http://model-service:5432/', '10.4.2.9').allowed).toBe(true)
    expect(decide(profile, 'https://other.model-service/', '10.4.2.9').allowed).toBe(false)
    for (const other of [...ALLOWLIST_PROFILES, ...LOCKED_PROFILES]) {
      if (other !== profile) {
        expect(decide(other, 'https://model-service/', '10.4.2.9').allowed).toBe(false)
      }
    }
  })

  it.each([
    ['http://10.4.2.9:11434', '10.4.2.9', '10.4.2.10'],
    ['http://[fd12:3456::9]:11434', 'fd12:3456::9', 'fd12:3456::10'],
  ])(
    'trusts a configured literal address without widening its range: %s',
    (url, address, neighbor) => {
      setEnv({ OLLAMA_URL: url })
      expect(decide('selfHostedService', url, address).allowed).toBe(true)
      expect(decide('selfHostedService', 'https://other-service/', neighbor).allowed).toBe(false)
      expect(decide('requestTarget', url, address).allowed).toBe(false)
      expect(decide('contentFetch', url, address).allowed).toBe(false)
    }
  )

  it('preserves explicit allowlists while adding model hosts', () => {
    envFlagsMock.egressAllowedHosts = 'other-service'
    envFlagsMock.egressAllowedIpRanges = '10.9.0.0/24'
    setEnv({ OLLAMA_URL: 'http://ollama:11434', AZURE_OPENAI_ENDPOINT: 'https://azure.corp' })
    for (const profile of ALLOWLIST_PROFILES) {
      expect(decide(profile, 'https://other-service/', '10.4.2.9').allowed).toBe(true)
      expect(decide(profile, 'https://subnet-service/', '10.9.0.5').allowed).toBe(true)
    }
    expect(decide('selfHostedService', 'http://ollama:11434/', '10.4.2.10').allowed).toBe(true)
    expect(decide('configuredEndpoint', 'https://azure.corp/', '10.4.2.11').allowed).toBe(true)
    expect(envFlagsMock.egressAllowedHosts).toBe('other-service')
    expect(envFlagsMock.egressAllowedIpRanges).toBe('10.9.0.0/24')
  })

  it.each(OPERATOR_MODEL_ENDPOINTS)('%s updates and revokes cached trust', (setting, profile) => {
    setEnv({ [setting]: 'https://first-service/' })
    expect(decide(profile, 'https://first-service/', '10.4.2.9').allowed).toBe(true)
    setEnv({ [setting]: 'https://second-service/' })
    expect(decide(profile, 'https://first-service/', '10.4.2.9').allowed).toBe(false)
    expect(decide(profile, 'https://second-service/', '10.4.2.10').allowed).toBe(true)
    setEnv({ [setting]: undefined })
    expect(decide(profile, 'https://second-service/', '10.4.2.10').allowed).toBe(false)
  })

  it.each(OPERATOR_MODEL_ENDPOINTS)(
    '%s never grants private access on hosted Sim',
    (setting, profile) => {
      setEnv({ [setting]: 'https://model-service/' })
      expect(decide(profile, 'https://model-service/', '10.4.2.9').allowed).toBe(true)
      envFlagsMock.isHosted = true
      expect(decide(profile, 'https://model-service/', '10.4.2.9').allowed).toBe(false)
    }
  )

  it.each([
    'not-a-url',
    'file://model-service/path',
    'ftp://model-service/path',
    'http://user:password@model-service/',
    'http://*.model-service/',
    'http://model-service,other-service/',
    'http://model..service/',
  ])('ignores an invalid or unsupported model endpoint: %s', (endpoint) => {
    setEnv({ OLLAMA_URL: endpoint })
    expect(decide('selfHostedService', 'https://model-service/', '10.4.2.9').allowed).toBe(false)
    expect(decide('selfHostedService', 'https://child.model-service/', '10.4.2.9').allowed).toBe(
      false
    )
  })

  it.each([
    ['http://169.254.169.254/', '169.254.169.254'],
    ['http://[fd00:ec2::254]/', 'fd00:ec2::254'],
    ['https://model-service/', '169.254.169.254'],
  ])('still blocks metadata through a configured model URL: %s', (url, address) => {
    setEnv({ OLLAMA_URL: url, AZURE_OPENAI_ENDPOINT: url })
    for (const profile of ['selfHostedService', 'configuredEndpoint'] as const) {
      expect(decide(profile, url, address)).toMatchObject({
        allowed: false,
        reason: 'address-metadata',
      })
    }
  })
})

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
  })

  it('exempts the proxy, whose scheme is fixed by the protocol rather than by trust', () => {
    envFlagsMock.isHosted = true
    expect(decide('proxy', 'http://proxy.example/', '93.184.216.34').allowed).toBe(true)
    expect(decide('proxy', 'http://proxy.example/', '10.4.2.9').allowed).toBe(false)
  })

  it('still permits ordinary public HTTPS', () => {
    envFlagsMock.isHosted = true
    expect(decide('requestTarget', 'https://api.example/', '93.184.216.34').allowed).toBe(true)
  })

  it('still refuses a service port on a public host', () => {
    envFlagsMock.isHosted = true
    expect(decide('requestTarget', 'https://api.example:5432/', '93.184.216.34').allowed).toBe(
      false
    )
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
    for (const profile of ['configuredEndpoint', 'selfHostedService', 'requestTarget'] as const) {
      expect(decide(profile, 'https://pg.corp/', '10.4.2.9').allowed).toBe(false)
    }
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
