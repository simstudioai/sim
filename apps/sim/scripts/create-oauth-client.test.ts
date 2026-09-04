/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertRedirectUri,
  assertTerminalSafe,
  parseList,
  parseOptionalBoolean,
} from '@/scripts/create-oauth-client'

describe('create OAuth client input validation', () => {
  it('parses comma-separated values without retaining blanks', () => {
    expect(parseList(' api:read, ,offline_access ', [])).toEqual(['api:read', 'offline_access'])
  })

  it('accepts only explicit boolean values', () => {
    expect(parseOptionalBoolean('OAUTH_CLIENT_PUBLIC', undefined)).toBe(false)
    expect(parseOptionalBoolean('OAUTH_CLIENT_PUBLIC', 'TRUE')).toBe(true)
    expect(parseOptionalBoolean('OAUTH_CLIENT_PUBLIC', 'false')).toBe(false)
    expect(() => parseOptionalBoolean('OAUTH_CLIENT_PUBLIC', 'yes')).toThrow(
      'OAUTH_CLIENT_PUBLIC must be true or false'
    )
  })

  it.each(['https://app.example/callback', 'http://127.0.0.1/callback', 'http://[::1]/callback'])(
    'accepts a secure or loopback redirect URI: %s',
    (uri) => {
      expect(() => assertRedirectUri(uri)).not.toThrow()
    }
  )

  it.each(['http://app.example/callback', 'https://app.example/callback#fragment', 'not a URL'])(
    'rejects an unsafe redirect URI: %s',
    (uri) => {
      expect(() => assertRedirectUri(uri)).toThrow()
    }
  )

  it('rejects terminal control characters before values can be printed', () => {
    expect(() => assertTerminalSafe('OAUTH_CLIENT_NAME', 'trusted\u001b[2J')).toThrow(
      'OAUTH_CLIENT_NAME cannot contain control characters'
    )
  })
})
