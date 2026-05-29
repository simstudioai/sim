/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import { getOAuthProviderConfigStatus, getOAuthRedirectUri } from '@/lib/oauth/provider-config'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('getOAuthProviderConfigStatus', () => {
  it('reports missing Google OAuth env vars with the provider redirect URI', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    process.env.GOOGLE_CLIENT_ID = ''
    process.env.GOOGLE_CLIENT_SECRET = ''

    const status = getOAuthProviderConfigStatus('google-sheets')

    expect(status.available).toBe(false)
    expect(status.status).toBe('missing_env')
    expect(status.requiredEnv).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
    expect(status.redirectUri).toBe('http://localhost:3000/api/auth/oauth2/callback/google-sheets')
    expect(status.message).toContain('GOOGLE_CLIENT_ID')
    expect(status.message).toContain('GOOGLE_CLIENT_SECRET')
  })

  it('blocks placeholder Google OAuth credentials', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    process.env.GOOGLE_CLIENT_ID = 'your-google-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'your-google-client-secret'

    const status = getOAuthProviderConfigStatus('google-drive')

    expect(status.available).toBe(false)
    expect(status.status).toBe('placeholder_env')
  })

  it('rejects malformed Google OAuth client IDs before redirecting to Google', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    process.env.GOOGLE_CLIENT_ID = 'not-a-google-client'
    process.env.GOOGLE_CLIENT_SECRET = 'real-secret'

    const status = getOAuthProviderConfigStatus('google-sheets')

    expect(status.available).toBe(false)
    expect(status.status).toBe('invalid_env')
    expect(status.message).toContain('.apps.googleusercontent.com')
  })

  it('accepts configured Google OAuth credentials', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://sim.example.com/'
    process.env.GOOGLE_CLIENT_ID = '123.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'real-secret'

    const status = getOAuthProviderConfigStatus('google-sheets')

    expect(status.available).toBe(true)
    expect(status.status).toBe('ready')
    expect(status.redirectUri).toBe(
      'https://sim.example.com/api/auth/oauth2/callback/google-sheets'
    )
  })

  it('does not block non-Google providers', () => {
    const status = getOAuthProviderConfigStatus('slack')

    expect(status.available).toBe(true)
    expect(status.requiredEnv).toEqual([])
  })
})

describe('getOAuthRedirectUri', () => {
  it('normalizes a trailing slash on the base URL', () => {
    expect(getOAuthRedirectUri('google-sheets', 'https://sim.example.com/')).toBe(
      'https://sim.example.com/api/auth/oauth2/callback/google-sheets'
    )
  })
})
