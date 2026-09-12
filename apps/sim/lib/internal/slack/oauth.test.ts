/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/security/input-validation.server')>()),
  secureFetchWithValidation: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import {
  exchangeSlackBotAuthorization,
  revokeSlackBotAuthorization,
  validateSlackBotAuthorization,
} from '@/lib/internal/slack/oauth'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

const fetchMock = vi.fn()
const input = {
  clientId: 'client',
  clientSecret: 'secret',
  code: 'code',
  redirectUri: 'https://sim.test/api/knowledge/slack/oauth/callback',
}
const grant = {
  ok: true as const,
  app_id: 'A1',
  token_type: 'bot' as const,
  access_token: 'test-bot-token',
  bot_user_id: 'UBOT',
  scope: SLACK_SEARCH_SCOPES.join(','),
  team: { id: 'T1', name: 'Test' },
}
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue(Response.json(grant))
})
describe('Slack bot OAuth exchange', () => {
  it('exchanges a code with the same callback and client authentication', async () => {
    expect(await exchangeSlackBotAuthorization(input)).toEqual(grant)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://slack.com/api/oauth.v2.access')
    expect(request.headers.Authorization).toBe(
      `Basic ${Buffer.from('client:secret').toString('base64')}`
    )
    const body = new URLSearchParams(request.body)
    expect(body.get('redirect_uri')).toBe(input.redirectUri)
    expect(body.get('code')).toBe('code')
  })
  it.each([{ token_type: 'user' }, { ok: false, error: 'invalid_client_id' }])(
    'rejects incompatible or unsuccessful grants: %j',
    async (change) => {
      fetchMock.mockResolvedValueOnce(Response.json({ ...grant, ...change }))
      await expect(exchangeSlackBotAuthorization(input)).rejects.toThrow()
    }
  )
  it('does not expose provider credentials in error messages', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'SECRET-DO-NOT-LOG' }))
    await expect(exchangeSlackBotAuthorization(input)).rejects.toThrow('Slack authorization failed')
  })
})

describe('Slack bot grant policy and cleanup', () => {
  it.each([
    { is_enterprise_install: true },
    { refresh_token: 'refresh' },
    { expires_in: 3600 },
    { scope: 'chat:write' },
  ])('rejects unsupported grants after the caller takes ownership: %j', (change) => {
    expect(() => validateSlackBotAuthorization({ ...grant, ...change })).toThrow()
  })
  it('accepts the existing indexing bot scope policy', () => {
    expect(() => validateSlackBotAuthorization(grant)).not.toThrow()
  })
  it('requires the additional command scope for shared installs', () => {
    expect(() =>
      validateSlackBotAuthorization(grant, [...SLACK_SEARCH_SCOPES, 'commands'])
    ).toThrow('commands')
  })
  it('revokes an unused token through Slack with a bounded request', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, revoked: true }))
    await revokeSlackBotAuthorization('unused-token')
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/auth.revoke')
    expect(request.headers.Authorization).toBe('Bearer unused-token')
    expect(request.signal).toBeDefined()
  })
  it('fails visibly when Slack does not confirm revocation', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'SECRET-DO-NOT-LOG' }))
    await expect(revokeSlackBotAuthorization('unused-token')).rejects.toThrow(
      'Slack could not revoke'
    )
  })
})
