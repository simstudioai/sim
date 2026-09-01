/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  performCreateCredential: vi.fn(),
  getEffectiveDecryptedEnv: vi.fn(),
}))

vi.mock('@/lib/credentials/orchestration', () => ({
  performCreateCredential: mocks.performCreateCredential,
}))
vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mocks.getEffectiveDecryptedEnv,
}))

import { executeConnectSlackBot } from './connect-slack-bot'

const context = { userId: 'user-1', workspaceId: 'ws-1' } as never

const validParams = {
  displayName: 'Elder Bot',
  signingSecretEnvVar: 'SLACK_SIGNING_SECRET',
  botTokenEnvVar: 'SLACK_BOT_TOKEN',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getEffectiveDecryptedEnv.mockResolvedValue({
    SLACK_SIGNING_SECRET: 'shhh',
    SLACK_BOT_TOKEN: 'xoxb-123',
  })
  mocks.performCreateCredential.mockResolvedValue({
    success: true,
    created: true,
    credential: { id: 'cred-1', displayName: 'Elder Bot' },
  })
})

describe('executeConnectSlackBot', () => {
  it('resolves env vars server-side and mints the credential with the request URL', async () => {
    const result = await executeConnectSlackBot(validParams, context)

    expect(mocks.performCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-1',
        type: 'service_account',
        providerId: 'slack-custom-bot',
        displayName: 'Elder Bot',
        signingSecret: 'shhh',
        botToken: 'xoxb-123',
      })
    )
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      credentialId: 'cred-1',
      created: true,
      requestUrl: expect.stringContaining('/api/webhooks/slack/custom/cred-1'),
    })
  })

  it('names the missing env vars without leaking any values', async () => {
    mocks.getEffectiveDecryptedEnv.mockResolvedValue({ SLACK_SIGNING_SECRET: 'shhh' })

    const result = await executeConnectSlackBot(validParams, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('SLACK_BOT_TOKEN')
    expect(result.error).not.toContain('shhh')
    expect(mocks.performCreateCredential).not.toHaveBeenCalled()
  })

  it('requires displayName and both env var names', async () => {
    const missingName = await executeConnectSlackBot(
      { signingSecretEnvVar: 'A', botTokenEnvVar: 'B' },
      context
    )
    expect(missingName.success).toBe(false)
    expect(missingName.error).toContain('displayName')

    const missingVars = await executeConnectSlackBot({ displayName: 'Bot' }, context)
    expect(missingVars.success).toBe(false)
    expect(missingVars.error).toContain('signingSecretEnvVar')
  })

  it('surfaces orchestration failures (e.g. auth.test rejection or name conflict)', async () => {
    mocks.performCreateCredential.mockResolvedValue({
      success: false,
      error: 'Slack rejected the bot token',
    })

    const result = await executeConnectSlackBot(validParams, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Slack rejected the bot token')
  })

  it('requires workspace scope', async () => {
    const result = await executeConnectSlackBot(validParams, { userId: 'user-1' } as never)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Workspace')
  })
})
