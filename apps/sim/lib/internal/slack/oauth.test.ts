/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeSlackBotAuthorization } from '@/lib/internal/slack/oauth'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

const fetchMock = vi.fn()
const input = {
  clientId: 'client',
  clientSecret: 'secret',
  code: 'code',
  redirectUri: 'https://sim.test/api/knowledge/slack/oauth/callback',
}
const grant = {
  ok: true,
  app_id: 'A1',
  token_type: 'bot',
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
    expect(request.body.get('redirect_uri')).toBe(input.redirectUri)
    expect(request.body.get('code')).toBe('code')
  })
  it.each([
    { token_type: 'user' },
    { is_enterprise_install: true },
    { refresh_token: 'refresh' },
    { expires_in: 3600 },
    { scope: 'chat:write' },
    { ok: false, error: 'invalid_client_id' },
  ])('rejects incompatible or unsuccessful grants: %j', async (change) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...grant, ...change }))
    await expect(exchangeSlackBotAuthorization(input)).rejects.toThrow()
  })
  it('does not expose provider credentials in error messages', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: 'SECRET-DO-NOT-LOG' }))
    await expect(exchangeSlackBotAuthorization(input)).rejects.toThrow('Slack authorization failed')
  })
})
