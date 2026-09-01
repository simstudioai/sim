/**
 * @vitest-environment node
 */

import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEffectiveDecryptedEnv, mockGetExecutionEnvironment } = environmentUtilsMockFns

const { mockGetWorkspaceBilledAccountUserId } = vi.hoisted(() => ({
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

afterAll(resetEnvironmentUtilsMock)

import {
  resolveBackgroundWebhookEnv,
  resolveWebhookProviderConfig,
  resolveWebhookRecordProviderConfig,
} from '@/lib/webhooks/env-resolver'

describe('webhook env resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({
      SLACK_BOT_TOKEN: 'xoxb-resolved',
      SLACK_HOST: 'files.slack.com',
    })
  })

  it('resolves environment variables inside webhook provider config', async () => {
    const result = await resolveWebhookProviderConfig(
      {
        botToken: '{{SLACK_BOT_TOKEN}}',
        includeFiles: true,
        nested: {
          url: 'https://{{SLACK_HOST}}/api/files.info',
        },
      },
      'user-1',
      'workspace-1'
    )

    expect(result).toEqual({
      botToken: 'xoxb-resolved',
      includeFiles: true,
      nested: {
        url: 'https://files.slack.com/api/files.info',
      },
    })
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('returns a cloned webhook record with resolved provider config', async () => {
    const webhookRecord = {
      id: 'webhook-1',
      provider: 'slack',
      providerConfig: {
        botToken: '{{SLACK_BOT_TOKEN}}',
        includeFiles: true,
      },
    }

    const result = await resolveWebhookRecordProviderConfig(webhookRecord, 'user-1', 'workspace-1')

    expect(result).toEqual({
      ...webhookRecord,
      providerConfig: {
        botToken: 'xoxb-resolved',
        includeFiles: true,
      },
    })
    expect(result).not.toBe(webhookRecord)
    expect(result.providerConfig).not.toBe(webhookRecord.providerConfig)
  })

  it('reports only successful substitutions when resolving with a prepared environment', async () => {
    const onResolved = vi.fn()

    const result = await resolveWebhookProviderConfig(
      {
        exact: '{{SLACK_BOT_TOKEN}}',
        embedded: 'https://{{ SLACK_HOST }}/files',
        missing: '{{MISSING_SECRET}}',
        directLiteral: 'xoxb-resolved',
      },
      'user-1',
      'workspace-1',
      {
        envVars: {
          SLACK_BOT_TOKEN: 'xoxb-resolved',
          SLACK_HOST: 'files.slack.com',
        },
        onResolved,
      }
    )

    expect(result).toEqual({
      exact: 'xoxb-resolved',
      embedded: 'https://files.slack.com/files',
      missing: '{{MISSING_SECRET}}',
      directLiteral: 'xoxb-resolved',
    })
    expect(onResolved.mock.calls).toEqual([
      ['SLACK_BOT_TOKEN', 'xoxb-resolved'],
      ['SLACK_HOST', 'files.slack.com'],
    ])
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
  })
})

/**
 * An inbound delivery or a provider URL-validation challenge has no caller, so
 * it must resolve the two identities the executor resolves — otherwise the
 * workflow owner leaving the workspace silently stops the webhook's own signing
 * secret from resolving, and every caller here reads that as a rejected request
 * rather than an error.
 */
describe('resolveBackgroundWebhookEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveDecryptedEnv.mockResolvedValue({ FROM_SINGLE_IDENTITY: 'single' })
    mockGetExecutionEnvironment.mockResolvedValue({
      personalDecrypted: { OWNER_KEY: 'owner-value' },
      workspaceDecrypted: { WORKSPACE_KEY: 'workspace-value' },
    })
  })

  it('splits the workflow owner from the workspace billing account', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billing-1')

    const env = await resolveBackgroundWebhookEnv('owner-1', 'workspace-1')

    expect(mockGetExecutionEnvironment).toHaveBeenCalledWith('owner-1', 'billing-1', 'workspace-1')
    expect(env).toEqual({ OWNER_KEY: 'owner-value', WORKSPACE_KEY: 'workspace-value' })
    expect(mockGetEffectiveDecryptedEnv).not.toHaveBeenCalled()
  })

  /** Workspace variables win a name collision, matching every other execution path. */
  it('lets the workspace slice shadow the owner personal slice', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('billing-1')
    mockGetExecutionEnvironment.mockResolvedValue({
      personalDecrypted: { SHARED: 'personal' },
      workspaceDecrypted: { SHARED: 'workspace' },
    })

    const env = await resolveBackgroundWebhookEnv('owner-1', 'workspace-1')

    expect(env).toEqual({ SHARED: 'workspace' })
  })

  it('falls back to the single identity when the workspace has no billing account', async () => {
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue(null)

    const env = await resolveBackgroundWebhookEnv('owner-1', 'workspace-1')

    expect(mockGetExecutionEnvironment).not.toHaveBeenCalled()
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('owner-1', 'workspace-1')
    expect(env).toEqual({ FROM_SINGLE_IDENTITY: 'single' })
  })

  it('resolves a workspaceless webhook against the owner alone', async () => {
    const env = await resolveBackgroundWebhookEnv('owner-1')

    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockGetEffectiveDecryptedEnv).toHaveBeenCalledWith('owner-1')
    expect(env).toEqual({ FROM_SINGLE_IDENTITY: 'single' })
  })
})
