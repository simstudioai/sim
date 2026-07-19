/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildConnectCompletePath,
  buildConnectLoopbackUrl,
  buildDesktopConnectPath,
  isValidOAuthProviderId,
  sanitizeOAuthErrorSlug,
} from '@/app/desktop/connect/validation'

const STATE = 'a'.repeat(32)

describe('isValidOAuthProviderId', () => {
  it('accepts kebab-case service slugs and rejects everything else', () => {
    expect(isValidOAuthProviderId('google-email')).toBe(true)
    expect(isValidOAuthProviderId('slack')).toBe(true)
    expect(isValidOAuthProviderId('Google')).toBe(false)
    expect(isValidOAuthProviderId('a b')).toBe(false)
    expect(isValidOAuthProviderId('')).toBe(false)
    expect(isValidOAuthProviderId(undefined)).toBe(false)
  })
})

describe('sanitizeOAuthErrorSlug', () => {
  it('passes short slugs, collapses junk, and maps empty to null', () => {
    expect(sanitizeOAuthErrorSlug('oauth_failed')).toBe('oauth_failed')
    expect(sanitizeOAuthErrorSlug('access_denied')).toBe('access_denied')
    expect(sanitizeOAuthErrorSlug('x'.repeat(80))).toBe('oauth_error')
    expect(sanitizeOAuthErrorSlug('has spaces')).toBe('oauth_error')
    expect(sanitizeOAuthErrorSlug('')).toBeNull()
    expect(sanitizeOAuthErrorSlug(undefined)).toBeNull()
  })
})

describe('URL builders', () => {
  it('buildDesktopConnectPath round-trips provider, state, and port', () => {
    const path = buildDesktopConnectPath('google-email', STATE, 49152)
    const url = new URL(path, 'https://sim.ai')
    expect(url.pathname).toBe('/desktop/connect')
    expect(url.searchParams.get('provider')).toBe('google-email')
    expect(url.searchParams.get('state')).toBe(STATE)
    expect(url.searchParams.get('port')).toBe('49152')
  })

  it('buildConnectCompletePath carries state and port', () => {
    const url = new URL(buildConnectCompletePath(STATE, 49152), 'https://sim.ai')
    expect(url.pathname).toBe('/desktop/connect/complete')
    expect(url.searchParams.get('state')).toBe(STATE)
    expect(url.searchParams.get('port')).toBe('49152')
  })

  it('buildConnectLoopbackUrl targets the 127.0.0.1 connect callback, error optional', () => {
    expect(buildConnectLoopbackUrl(STATE, 49152)).toBe(
      `http://127.0.0.1:49152/connect/callback?state=${STATE}`
    )
    const withError = new URL(buildConnectLoopbackUrl(STATE, 49152, 'oauth_failed'))
    expect(withError.searchParams.get('error')).toBe('oauth_failed')
  })
})
