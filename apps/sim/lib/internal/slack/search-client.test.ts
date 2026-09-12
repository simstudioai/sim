/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/security/input-validation.server')>()),
  secureFetchWithValidation: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { getSlackSearchSender, verifySlackSearchBot } from '@/lib/internal/slack/search-client'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

const fetchMock = vi.fn()
const auth = { ok: true, team_id: 'T1', user_id: 'U1', bot_id: 'B1', team: 'Acme' }
function reply(data: unknown, scopes: readonly string[] = SLACK_SEARCH_SCOPES) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'x-oauth-scopes': scopes.join(',') },
  })
}
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('Slack Search provider verification', () => {
  it('derives the app and workspace from authenticated Slack APIs', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(auth))
      .mockResolvedValueOnce(reply({ ok: true, bot: { id: 'B1', app_id: 'A1' } }))
    await expect(verifySlackSearchBot('token')).resolves.toEqual({
      appId: 'A1',
      teamId: 'T1',
      teamName: 'Acme',
      botUserId: 'U1',
      enterpriseId: null,
    })
    expect(String(fetchMock.mock.calls[1][0])).toContain('bots.info?bot=B1')
  })
  it.each([{ bot_id: undefined }, { is_enterprise_install: true }])(
    'rejects user tokens and org-wide installs',
    async (change) => {
      fetchMock.mockResolvedValue(reply({ ...auth, ...change }))
      await expect(verifySlackSearchBot('token')).rejects.toThrow('single Slack workspace')
      expect(fetchMock).toHaveBeenCalledOnce()
    }
  )
  it('requires the email scope actually granted to the token', async () => {
    fetchMock.mockResolvedValue(reply(auth, ['chat:write', 'im:history', 'users:read']))
    await expect(verifySlackSearchBot('token')).rejects.toThrow('users:read.email')
  })
  it('refuses a token whose granted scopes cannot be verified', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(auth)))
    await expect(verifySlackSearchBot('token')).rejects.toThrow('Reinstall')
  })
  it.each([
    { deleted: true },
    { is_bot: true },
    { is_app_user: true },
    { team_id: 'T2' },
    { profile: {} },
  ])('refuses an inactive, nonhuman, or unresolved sender', async (change) => {
    fetchMock.mockResolvedValue(
      reply({
        ok: true,
        user: {
          id: 'U2',
          team_id: 'T1',
          deleted: false,
          is_bot: false,
          profile: { email: 'Alice@Example.com ' },
          ...change,
        },
      })
    )
    await expect(getSlackSearchSender('token', 'U2', 'T1')).resolves.toBeNull()
  })
  it('normalizes Slack-provided email', async () => {
    fetchMock.mockResolvedValue(
      reply({
        ok: true,
        user: {
          id: 'U2',
          team_id: 'T1',
          deleted: false,
          is_bot: false,
          profile: { email: 'Alice@Example.com ' },
        },
      })
    )
    await expect(getSlackSearchSender('token', 'U2', 'T1')).resolves.toEqual({
      email: 'alice@example.com',
    })
  })
  it('does not expose raw provider errors', async () => {
    fetchMock.mockResolvedValue(reply({ ok: false, error: 'sensitive-provider-response' }))
    await expect(verifySlackSearchBot('token')).rejects.toThrow('Check the bot connection')
  })
})
