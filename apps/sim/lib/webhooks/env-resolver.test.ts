import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetEffectiveDecryptedEnv, mockGetExecutionEnvironment } = environmentUtilsMockFns

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

afterAll(resetEnvironmentUtilsMock)

import {
  resolveBackgroundWebhookEnv,
  resolveWebhookProviderConfig,
} from '@/lib/webhooks/env-resolver'

const mockGetWorkspaceBilledAccountUserId =
  billingAttributionMockFns.mockGetWorkspaceBilledAccountUserId

describe('webhook env resolver', () => {
  beforeEach(() => {
    mockGetEffectiveDecryptedEnv.mockResolvedValue({
      SLACK_BOT_TOKEN: 'xoxb-resolved',
      SLACK_HOST: 'files.slack.com',
    })
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

  /** A suspended owner contributes nothing, including on the workspaceless path. */
  it('yields no personal variables for a suspended owner with no workspace', async () => {
    mockGetExecutionEnvironment.mockResolvedValue({
      personalDecrypted: {},
      workspaceDecrypted: {},
    })

    const env = await resolveBackgroundWebhookEnv('suspended-owner')

    expect(mockGetExecutionEnvironment).toHaveBeenCalledWith(
      'suspended-owner',
      'suspended-owner',
      undefined
    )
    expect(env).toEqual({})
  })
})
