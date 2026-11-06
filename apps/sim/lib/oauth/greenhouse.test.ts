import { describe, expect, it, vi } from 'vitest'
import {
  createGreenhouseProvider,
  getGreenhouseRefreshErrorCode,
  parseGreenhouseTokens,
} from '@/lib/oauth/greenhouse'

const CLIENT_ID = 'fixture-client'
const CLIENT_SECRET = 'fixture-client-secret'
const connector = createGreenhouseProvider({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectURI: 'https://example.invalid/callback',
  scopes: ['harvest:candidates:list', 'harvest:candidates:create'],
})

async function profileFor(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)))
  if (!connector.getUserInfo) throw new Error('Greenhouse requires token introspection')
  const tokens = { accessToken: 'fixture-access', scopes: ['unattested-scope'] }
  const profile = await connector.getUserInfo(tokens)
  return { profile, tokens }
}

const activeIntrospection = {
  active: true,
  client_id: CLIENT_ID,
  sub: '123',
  scope: 'harvest:candidates:list',
  token_type: 'bearer',
  username: 'fixture@example.invalid',
  'https://auth.greenhouse.io/claims': {
    organization: { id: 456, name: 'Example organization' },
  },
}

describe('Greenhouse partner OAuth', () => {
  it('preserves the attested token expiration and rotating refresh lifetime', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    const tokens = parseGreenhouseTokens(
      {
        access_token: 'fixture-access',
        refresh_token: 'fixture-rotated-refresh',
        token_type: 'Bearer',
        expires_at: '2026-10-01T12:20:00Z',
      },
      now
    )
    expect(tokens.accessTokenExpiresAt).toEqual(new Date('2026-10-01T12:20:00Z'))
    expect(tokens.refreshTokenExpiresAt).toEqual(new Date('2026-10-15T12:00:00Z'))
  })

  it.each([
    { expires_at: '2026-10-01T11:59:00Z', refresh_token: 'fixture-refresh' },
    { expires_at: '2026-10-01T12:20:00Z' },
    { expires_at: 'invalid', refresh_token: 'fixture-refresh' },
  ])('rejects a token that cannot safely be stored or renewed', (fields) => {
    expect(() =>
      parseGreenhouseTokens(
        { access_token: 'fixture-access', token_type: 'Bearer', ...fields },
        new Date('2026-10-01T12:00:00Z')
      )
    ).toThrow('Invalid Greenhouse token response')
  })

  it('uses provider-attested identity and scopes without promoting requested permissions', async () => {
    const { profile, tokens } = await profileFor(activeIntrospection)
    expect(profile).toMatchObject({ email: 'fixture@example.invalid', emailVerified: false })
    expect(tokens.scopes).toEqual(['harvest:candidates:list'])
  })

  it.each([
    { active: false },
    { ...activeIntrospection, client_id: 'another-client' },
    { ...activeIntrospection, sub: undefined },
  ])('rejects inactive, foreign-client, or unidentified credentials', async (payload) => {
    await expect(profileFor(payload)).rejects.toThrow(
      'Greenhouse token identity could not be verified'
    )
  })

  it('never exposes upstream error bodies containing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ message: CLIENT_SECRET }, { status: 400 }))
    )
    if (!connector.getUserInfo) throw new Error('Greenhouse requires token introspection')
    await expect(connector.getUserInfo({ accessToken: 'fixture-access' })).rejects.toThrow(
      'Greenhouse token introspection failed with HTTP 400'
    )
  })

  it('classifies consumed refresh tokens without treating app configuration failures as revocation', () => {
    expect(
      getGreenhouseRefreshErrorCode({
        errors: ['Refresh token has already been exchanged for new tokens'],
      })
    ).toBe('invalid_grant')
    expect(
      getGreenhouseRefreshErrorCode({
        errors: ['Client application cannot perform grant_type=refresh_token'],
      })
    ).toBeUndefined()
  })
})
