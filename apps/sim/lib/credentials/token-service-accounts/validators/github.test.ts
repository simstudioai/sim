/**
 * @vitest-environment node
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateGitHubServiceAccount } from '@/lib/credentials/token-service-accounts/validators/token-checks'

const TOKEN = 'test-github-token'

describe('GitHub saved personal access token verification', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  it('verifies the token against api.github.com as the tools send it and names it by login', async () => {
    fetch.mockResolvedValue(jsonResponse({ login: 'octo-bot', id: 1 }))

    await expect(validateGitHubServiceAccount({ apiToken: TOKEN })).resolves.toMatchObject({
      displayName: 'octo-bot (GitHub)',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
          'User-Agent': 'Sim',
        }),
      })
    )
  })

  it.each([
    ['a bad or revoked token', 401, { message: 'Bad credentials' }],
    [
      'a GitHub App installation token, which cannot act as a user',
      403,
      { message: 'Resource not accessible by integration' },
    ],
  ])('rejects %s as invalid credentials, never echoing the token', async (_, status, body) => {
    fetch.mockResolvedValue(jsonResponse(body, status))

    const error = await validateGitHubServiceAccount({ apiToken: TOKEN }).catch((e) => e)

    expect(error).toMatchObject({ code: 'invalid_credentials' })
    expect(JSON.stringify(error.logDetail)).not.toContain(TOKEN)
    expect(error.message).not.toContain(TOKEN)
  })

  it.each([
    ['a rate limit', jsonResponse({ message: 'API rate limit exceeded' }, 429)],
    ['an outage', new Response('<html>unicorn</html>', { status: 503 })],
    ['a reply that is not a user', jsonResponse({ ok: true })],
  ])('reports %s as GitHub being unavailable, not as a bad token', async (_, reply) => {
    fetch.mockResolvedValue(reply)

    await expect(validateGitHubServiceAccount({ apiToken: TOKEN })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  describe('token expiry', () => {
    const NOW = new Date('2026-11-11T12:00:00.000Z')

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function userReply(expiration?: string) {
      return jsonResponse(
        { login: 'octo-bot', id: 1 },
        expiration ? { headers: { 'GitHub-Authentication-Token-Expiration': expiration } } : 200
      )
    }

    it.each([
      ['a UTC timestamp', '2026-12-01 10:30:00 UTC', '2026-12-01T10:30:00.000Z'],
      [
        'a timestamp with a numeric offset',
        '2026-12-01 12:30:00 +0200',
        '2026-12-01T10:30:00.000Z',
      ],
    ])('records the expiry GitHub reports as %s', async (_, header, expected) => {
      fetch.mockResolvedValue(userReply(header))

      const result = await validateGitHubServiceAccount({ apiToken: TOKEN })

      expect(result.expiresAt?.toISOString()).toBe(expected)
    })

    it.each([
      ['no expiry header (a token that never expires)', undefined],
      ['an unreadable expiry', 'next Tuesday'],
      ['an impossible date', '2026-13-45 10:00:00 UTC'],
      ['an expiry in the past, contradicting the accepted request', '2026-11-10 12:00:00 UTC'],
      [
        'an expiry minutes away, which GitHub has wrongly reported for live tokens',
        '2026-11-11 12:01:00 UTC',
      ],
    ])('records no expiry for %s and still accepts the token', async (_, header) => {
      fetch.mockResolvedValue(userReply(header))

      const result = await validateGitHubServiceAccount({ apiToken: TOKEN })

      expect(result.displayName).toBe('octo-bot (GitHub)')
      expect(result.expiresAt).toBeUndefined()
    })
  })
})
