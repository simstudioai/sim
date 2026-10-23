import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SLACK_SHARED_SEARCH_BOT_SCOPES } from '@/lib/slack-search/constants'

const m = vi.hoisted(() => ({ app: vi.fn(), exchange: vi.fn() }))
vi.mock('@/lib/slack-search/shared-app-env', () => ({
  getSharedSlackSearchAppConfiguration: m.app,
}))
vi.mock('@/lib/internal/slack/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/internal/slack/oauth')>()),
  exchangeSlackBotAuthorization: m.exchange,
}))

import { authenticateSlackPublicInstallation } from '@/lib/slack-search/public-install-auth'

const grant = {
  ok: true,
  app_id: 'A1',
  token_type: 'bot',
  access_token: 'bot-token',
  bot_user_id: 'UBOT',
  scope: SLACK_SHARED_SEARCH_BOT_SCOPES.join(','),
  team: { id: 'T1', name: 'Test' },
}
beforeEach(() => {
  setEnvFlags({ isHosted: true })
  m.app.mockReturnValue({ id: 'A1', clientId: 'client', clientSecret: 'secret', revision: 'r1' })
  m.exchange.mockResolvedValue(grant)
})
describe('Slack-initiated installation authentication', () => {
  it('completes the Slack install without returning tokens or asserting a Sim identity', async () => {
    const result = await authenticateSlackPublicInstallation('one-use-code')
    expect(m.exchange).toHaveBeenCalledWith({
      clientId: 'client',
      clientSecret: 'secret',
      code: 'one-use-code',
    })
    expect(result).toEqual({ teamId: 'T1' })
  })
  it.each([
    { app_id: 'A2' },
    { scope: 'chat:write' },
    { is_enterprise_install: true },
    { refresh_token: 'refresh' },
  ])('rejects incompatible grants: %j', async (change) => {
    m.exchange.mockResolvedValue({ ...grant, ...change })
    await expect(authenticateSlackPublicInstallation('code')).rejects.toThrow()
  })
  it('fails on an expired or replayed provider code', async () => {
    m.exchange.mockRejectedValue(new Error('Slack authorization failed'))
    await expect(authenticateSlackPublicInstallation('used-code')).rejects.toThrow(
      'Slack authorization failed'
    )
  })
  it.each(['self-hosted', 'unconfigured'])(
    'rejects %s deployments before exchange',
    async (deployment) => {
      if (deployment === 'self-hosted') setEnvFlags({ isHosted: false })
      else m.app.mockReturnValue(null)
      await expect(authenticateSlackPublicInstallation('code')).rejects.toThrow('unavailable')
      expect(m.exchange).not.toHaveBeenCalled()
    }
  )
})
