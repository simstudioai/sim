/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findGrantedResourceOrigin, resolveResourceOrigin } from '@/lib/oauth/resource-url'
import type { OAuthResourceUrlConfig } from '@/lib/oauth/types'

const config: OAuthResourceUrlConfig = {
  title: 'Environment URL',
  placeholder: 'https://myorg.crm.dynamics.com',
  allowedHostSuffixes: ['.dynamics.com', '.microsoftdynamics.us'],
  scopeSuffix: '/user_impersonation',
}

describe('resolveResourceOrigin', () => {
  it('accepts an allowed host and reduces it to a bare origin', () => {
    const result = resolveResourceOrigin('https://myorg.crm.dynamics.com/api/data/v9.2/', config)
    expect(result).toEqual({ ok: true, origin: 'https://myorg.crm.dynamics.com' })
  })

  it('assumes https when the scheme is omitted, which is how users paste a host', () => {
    const result = resolveResourceOrigin('myorg.crm4.dynamics.com', config)
    expect(result).toEqual({ ok: true, origin: 'https://myorg.crm4.dynamics.com' })
  })

  it('matches on the registrable domain so new provider regions keep working', () => {
    expect(resolveResourceOrigin('https://org.crm17.dynamics.com', config).ok).toBe(true)
    expect(resolveResourceOrigin('https://org.crm.microsoftdynamics.us', config).ok).toBe(true)
  })

  it('rejects a host outside the allow list, which would set the token audience', () => {
    const result = resolveResourceOrigin('https://attacker.example', config)
    expect(result.ok).toBe(false)
  })

  it('rejects a lookalike host that only contains an allowed suffix mid-string', () => {
    expect(resolveResourceOrigin('https://dynamics.com.attacker.example', config).ok).toBe(false)
  })

  it('rejects plaintext http so the resource cannot be downgraded', () => {
    expect(resolveResourceOrigin('http://myorg.crm.dynamics.com', config).ok).toBe(false)
  })

  it('rejects an explicit port, which no provider serves its resource on', () => {
    expect(resolveResourceOrigin('https://myorg.crm.dynamics.com:8443', config).ok).toBe(false)
  })

  it('accepts the default https port, which URL drops from the origin', () => {
    const result = resolveResourceOrigin('https://myorg.crm.dynamics.com:443', config)
    expect(result).toEqual({ ok: true, origin: 'https://myorg.crm.dynamics.com' })
  })

  it('rejects embedded credentials', () => {
    expect(resolveResourceOrigin('https://u:p@myorg.crm.dynamics.com', config).ok).toBe(false)
  })

  it('rejects an empty value rather than building a scope from nothing', () => {
    expect(resolveResourceOrigin('   ', config).ok).toBe(false)
    expect(resolveResourceOrigin(undefined, config).ok).toBe(false)
  })
})

describe('findGrantedResourceOrigin', () => {
  it('recovers the origin from the granted resource scope', () => {
    const scopes = ['openid', 'offline_access', 'https://myorg.crm.dynamics.com/user_impersonation']
    expect(findGrantedResourceOrigin(scopes, config)).toBe('https://myorg.crm.dynamics.com')
  })

  it('returns undefined when no scope names a resource, which marks a credential unusable', () => {
    expect(findGrantedResourceOrigin(['openid', 'offline_access'], config)).toBeUndefined()
    expect(findGrantedResourceOrigin([], config)).toBeUndefined()
    expect(findGrantedResourceOrigin(undefined, config)).toBeUndefined()
  })

  it('ignores a resource scope whose host is not allowed', () => {
    expect(
      findGrantedResourceOrigin(['https://attacker.example/user_impersonation'], config)
    ).toBeUndefined()
  })

  it('ignores a scope that merely contains the suffix mid-string', () => {
    expect(
      findGrantedResourceOrigin(['https://myorg.crm.dynamics.com/user_impersonation.other'], config)
    ).toBeUndefined()
  })
})
