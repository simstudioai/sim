import { account, credential, webhook, workflowDeploymentVersion } from '@sim/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { eq, ne } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

// deploy.ts pulls in the trigger/block/provider registries at module load; none are exercised by
// buildProviderConfig (a pure function), so stub them to keep this unit test fast and isolated.
const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))
// `deploy.ts` reads the registry through `@/blocks`, while the trigger-id resolution it now
// shares (`@/triggers/webhook-url`) reads `@/blocks/registry`. Point both specifiers at ONE spy
// so a test configuring the block config governs the whole path, not half of it.
vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))
vi.mock('@/blocks/registry', () => ({ getBlock: mockGetBlock }))
vi.mock('@/triggers', () => ({ getTrigger: vi.fn(), isTriggerValid: vi.fn(() => true) }))
vi.mock('@/lib/webhooks/providers', () => ({ getProviderHandler: vi.fn() }))
vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: vi.fn(),
  createExternalWebhookSubscription: vi.fn(),
  hasWebhookConfigChanged: vi.fn(),
}))
vi.mock('@/lib/webhooks/utils.server', () => ({
  findConflictingWebhookPathOwner: vi.fn(),
}))
vi.mock('@/lib/webhooks/pending-verification', () => ({
  PendingWebhookVerificationTracker: vi.fn(),
}))
const { mockIsDeploymentVersionActive, mockIsDeploymentVersionProtected } = vi.hoisted(() => ({
  mockIsDeploymentVersionActive: vi.fn(),
  mockIsDeploymentVersionProtected: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  isDeploymentVersionActive: mockIsDeploymentVersionActive,
  isDeploymentVersionProtectedByCurrentOperation: mockIsDeploymentVersionProtected,
}))

const {
  mockGetQuickBooksWebhookCredential,
  mockGetSlackBotCredential,
  mockResolveOAuthAccountId,
  mockRefreshAccessTokenIfNeeded,
  mockFetchSlackTeamId,
} = vi.hoisted(() => ({
  mockGetQuickBooksWebhookCredential: vi.fn(),
  mockGetSlackBotCredential: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockFetchSlackTeamId: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  getSlackBotCredential: mockGetSlackBotCredential,
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))
vi.mock('@/lib/webhooks/providers/slack', () => ({
  fetchSlackTeamId: mockFetchSlackTeamId,
}))
vi.mock('@/lib/webhooks/quickbooks-credentials', () => ({
  buildQuickBooksWebhookRoutingKey: (appKey: string, realmId: string) => `${appKey}:${realmId}`,
  getQuickBooksWebhookClientConfigByCredentialId: mockGetQuickBooksWebhookCredential,
}))

import {
  buildProviderConfig,
  cleanupInactiveDeploymentWebhooks,
  resolveTriggerCredentialId,
  resolveWebhookConfigForBlock,
} from '@/lib/webhooks/deploy'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { quickBooksHandler } from '@/lib/webhooks/providers/quickbooks'
import { getBlock } from '@/blocks'
import { getTrigger } from '@/triggers'

afterAll(() => {
  resetDbChainMock()
  resetEnvMock()
  resetEnvFlagsMock()
})

const trigger = (subBlocks: Partial<SubBlockConfig>[]): { subBlocks: SubBlockConfig[] } => ({
  subBlocks: subBlocks as SubBlockConfig[],
})

const driveTrigger = trigger([
  {
    id: 'triggerCredentials',
    mode: 'trigger',
    canonicalParamId: 'oauthCredential',
    serviceId: 'google-drive',
  },
  { id: 'folderId', mode: 'trigger', canonicalParamId: 'folderId', required: false },
  { id: 'manualFolderId', mode: 'trigger-advanced', canonicalParamId: 'folderId', required: false },
])

const tableTrigger = trigger([
  { id: 'tableSelector', mode: 'trigger', canonicalParamId: 'tableId', required: true },
  { id: 'manualTableId', mode: 'trigger-advanced', canonicalParamId: 'tableId', required: true },
])

const slackTrigger = trigger([
  { id: 'eventType', mode: 'trigger', required: true },
  {
    id: 'customBotCredential',
    mode: 'trigger',
    canonicalParamId: 'botCredential',
    serviceId: 'slack',
    required: true,
  },
  {
    id: 'manualBotCredential',
    mode: 'trigger-advanced',
    canonicalParamId: 'botCredential',
    required: true,
  },
])

const tiktokTrigger = trigger([
  {
    id: 'triggerCredentials',
    mode: 'trigger',
    serviceId: 'tiktok',
    required: true,
  },
])

function makeBlock(
  type: string,
  subBlockValues: Record<string, unknown>,
  canonicalModes?: Record<string, 'basic' | 'advanced'>
): BlockState {
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(subBlockValues)) subBlocks[key] = { value }
  return {
    id: 'block-1',
    type,
    subBlocks,
    ...(canonicalModes ? { data: { canonicalModes } } : {}),
  } as unknown as BlockState
}

beforeEach(() => {
  resetDbChainMock()
  setEnv({ SLACK_SIGNING_SECRET: 'test-secret' })
  setEnvFlags({ isSlackExtendedScopesEnabled: true })
  ;(getProviderHandler as unknown as Mock).mockImplementation((provider: string) =>
    provider === 'quickbooks' ? quickBooksHandler : {}
  )
})

describe('buildProviderConfig canonical collapse', () => {
  it('collapses a drift block (stale basic + active advanced via override) to the active value', () => {
    const block = makeBlock(
      'google_drive_poller',
      { folderId: 'STALE', manualFolderId: 'ACTIVE' },
      { folderId: 'advanced' }
    )
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    // The canonical key collapses to the active (advanced) value, not the stale basic value.
    expect(providerConfig.folderId).toBe('ACTIVE')
    expect(providerConfig.manualFolderId).toBe('ACTIVE')
  })

  it('honors a basic-mode override even when advanced is populated', () => {
    const block = makeBlock(
      'google_drive_poller',
      { folderId: 'BASIC', manualFolderId: 'ADVANCED' },
      { folderId: 'basic' }
    )
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBe('BASIC')
  })

  it('omits the canonical key when the active value is empty (optional field)', () => {
    const block = makeBlock('google_drive_poller', {})
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBeUndefined()
  })

  it('collapses the slack bot credential pair under botCredential for the routing branch', () => {
    const block = makeBlock('slack_v2', {
      eventType: 'message',
      customBotCredential: 'cred_bot_1',
    })
    const result = buildProviderConfig(block, 'slack_oauth', slackTrigger)

    expect(result.providerConfig.botCredential).toBe('cred_bot_1')
    expect(result.providerConfig.eventType).toBe('message')
    // The slack trigger has no generic triggerCredentials field — the routing
    // branch resolves botCredential itself.
    expect(result.credentialReference).toBeUndefined()
    expect(result.credentialServiceId).toBeUndefined()
  })

  it('reports a missing required slack bot credential as a missing field', () => {
    const block = makeBlock('slack_v2', { eventType: 'message' })
    const result = buildProviderConfig(block, 'slack_oauth', slackTrigger)

    expect(result.missingFields.length).toBeGreaterThan(0)
  })
})

describe('resolveTriggerCredentialId', () => {
  it('canonicalizes an OAuth service alias at the credential lookup boundary', async () => {
    await resolveTriggerCredentialId('credential-1', 'workspace-1', 'gmail')

    expect(eq).toHaveBeenCalledWith(credential.workspaceId, 'workspace-1')
    expect(eq).toHaveBeenCalledWith(credential.type, 'oauth')
    expect(eq).toHaveBeenCalledWith(credential.providerId, 'google-email')
    expect(eq).toHaveBeenCalledWith(credential.id, 'credential-1')
    expect(eq).toHaveBeenCalledWith(credential.accountId, 'credential-1')
  })
})

describe('resolveWebhookConfigForBlock — slack_oauth routing', () => {
  const slackTriggerDef = {
    provider: 'slack_app',
    name: 'Slack',
    subBlocks: [
      { id: 'eventType', mode: 'trigger', required: true },
      {
        id: 'customBotCredential',
        mode: 'trigger',
        canonicalParamId: 'botCredential',
        serviceId: 'slack',
        required: true,
      },
      {
        id: 'manualBotCredential',
        mode: 'trigger-advanced',
        canonicalParamId: 'botCredential',
        required: true,
      },
      { id: 'commandFilter', mode: 'trigger', required: false },
    ],
  }

  function resolveSlack(
    values: Record<string, unknown>,
    workflow: Record<string, unknown> = { workspaceId: 'ws-1' }
  ) {
    ;(getBlock as unknown as Mock).mockReturnValue({ category: 'triggers' })
    ;(getTrigger as unknown as Mock).mockReturnValue(slackTriggerDef)
    return resolveWebhookConfigForBlock({
      block: makeBlock('slack_oauth', values),
      blocks: {},
      workflow,
      userId: 'deployer-1',
      requestId: 'req-1',
    })
  }

  it.each([
    'message',
    'app_context_changed',
    'agent_session_stopped',
    'agent_session_title_changed',
  ])('routes custom-bot %s without the native app signing secret', async (eventType) => {
    setEnvFlags({ isSlackExtendedScopesEnabled: false })
    setEnv({ SLACK_SIGNING_SECRET: undefined })
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-token',
      teamId: 'T123',
      botUserId: 'BUSER',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({ eventType, customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.bot_user_id).toBe('BUSER')
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it.each([
    ['assistant_thread_started', 'customBotCredential'],
    ['assistant_thread_context_changed', 'customBotCredential'],
    ['assistant_thread_started', 'manualBotCredential'],
    ['assistant_thread_context_changed', 'manualBotCredential'],
  ])('rejects persisted custom-bot %s through %s before deployment', async (eventType, field) => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-token',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({ eventType, [field]: 'cred_bot_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error).toEqual({
      message:
        'Legacy Assistant events require a native Sim Slack connection. Choose an Agent View event for a custom bot.',
      status: 400,
    })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it('does not validate an identity-less migrated bot for ordinary triggers', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-migrated',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.providerConfig.bot_user_id).toBeUndefined()
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it('rejects a Sim-app credential when extended scopes are disabled', async () => {
    setEnvFlags({ isSlackExtendedScopesEnabled: false })
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_oauth_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error).toEqual({
      message: 'The Sim Slack app trigger is disabled for this deployment. Select a custom bot.',
      status: 400,
    })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it('rejects a custom bot credential from another workspace', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'other-ws',
      botToken: 'xoxb-token',
      teamId: 'T123',
      botUserId: 'BUSER',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('not available in this workspace')
  })

  it('rejects an OAuth credential not resolvable in the workflow workspace', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })
    // No credential row queued → resolveTriggerCredentialId returns null.

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_foreign' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('not available in this workspace')
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
  })

  it('rejects a non-simSubscribed event on the native Sim app (OAuth account)', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })
    queueTableRows(credential, [{ id: 'cred_oauth_1' }])

    const result = await resolveSlack({
      eventType: 'file_shared',
      customBotCredential: 'cred_oauth_1',
    })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('not available on the Sim Slack app')
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
  })
})

describe('resolveWebhookConfigForBlock — migrated slack_webhook routing', () => {
  const legacySlackTriggerDef = {
    provider: 'slack',
    name: 'Slack Webhook',
    subBlocks: [
      { id: 'signingSecret', mode: 'trigger', required: true },
      { id: 'botToken', mode: 'trigger' },
      { id: 'botCredential', mode: 'trigger' },
    ],
  }

  function resolveLegacySlack(values: Record<string, unknown>) {
    ;(getBlock as unknown as Mock).mockReturnValue({ category: 'triggers' })
    ;(getTrigger as unknown as Mock).mockReturnValue(legacySlackTriggerDef)
    return resolveWebhookConfigForBlock({
      block: makeBlock('slack_webhook', values),
      blocks: {},
      workflow: { workspaceId: 'ws-1' },
      userId: 'deployer-1',
      requestId: 'req-1',
    })
  }

  it('keeps the legacy path while routing the webhook by its migrated bot credential', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-token',
      signingSecret: 'secret',
    })

    const result = await resolveLegacySlack({
      signingSecret: 'legacy-secret',
      botToken: 'legacy-token',
      botCredential: 'cred_bot_1',
      triggerPath: 'legacy-path',
    })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.triggerPath).toBe('legacy-path')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.providerConfig).toMatchObject({
      botCredential: 'cred_bot_1',
      credentialId: 'cred_bot_1',
      ingressMode: 'legacy_custom_bot',
    })
  })
})

describe('resolveWebhookConfigForBlock — TikTok routing', () => {
  const tiktokTriggerDef = {
    provider: 'tiktok',
    name: 'TikTok',
    subBlocks: tiktokTrigger.subBlocks,
  }

  function resolveTikTok(
    credentialReference = 'credential-1',
    workflow: Record<string, unknown> = { workspaceId: 'ws-1' }
  ) {
    ;(getBlock as unknown as Mock).mockReturnValue({ category: 'triggers' })
    ;(getTrigger as unknown as Mock).mockReturnValue(tiktokTriggerDef)
    return resolveWebhookConfigForBlock({
      block: makeBlock('tiktok', { triggerCredentials: credentialReference }),
      blocks: {},
      workflow,
      userId: 'deployer-1',
      requestId: 'req-1',
    })
  }

  it('rejects a TikTok credential not available in the workflow workspace', async () => {
    const result = await resolveTikTok('foreign-credential')

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error.message).toContain('not available in this workspace')
    expect(mockResolveOAuthAccountId).not.toHaveBeenCalled()
  })

  it('rejects a malformed TikTok account identity', async () => {
    queueTableRows(credential, [{ id: 'credential-1' }])
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'account-1' })
    queueTableRows(account, [{ accountId: 'missing-generated-uuid' }])

    const result = await resolveTikTok()

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error.message).toContain('Reconnect')
  })
})

describe('resolveWebhookConfigForBlock — QuickBooks routing', () => {
  const quickBooksTriggerDef = {
    provider: 'quickbooks',
    name: 'QuickBooks Invoice Events',
    subBlocks: [
      {
        id: 'triggerCredentials',
        mode: 'trigger',
        serviceId: 'quickbooks',
        required: true,
      },
    ],
  }

  function resolveQuickBooks(
    credentialReference: string,
    workflow: Record<string, unknown> = { workspaceId: 'ws-1' }
  ) {
    ;(getBlock as unknown as Mock).mockReturnValue({ category: 'tools' })
    ;(getTrigger as unknown as Mock).mockReturnValue(quickBooksTriggerDef)
    const block = makeBlock('quickbooks', {
      selectedTriggerId: 'quickbooks_invoice_events',
      triggerCredentials: credentialReference,
    })
    block.triggerMode = true
    return resolveWebhookConfigForBlock({
      block,
      blocks: {},
      workflow,
      userId: 'deployer-1',
      requestId: 'req-1',
    })
  }

  it('rejects a QuickBooks credential outside the workflow workspace', async () => {
    const result = await resolveQuickBooks('cred-foreign')

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.message).toContain('not available in this workspace')
    expect(mockGetQuickBooksWebhookCredential).not.toHaveBeenCalled()
  })
})

describe('cleanupInactiveDeploymentWebhooks', () => {
  const workflow = { id: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1' }
  const input = {
    workflowId: 'workflow-1',
    workflow,
    requestId: 'request-1',
    protectedDeploymentVersionId: null,
    limit: 5,
  }

  function staleWebhookRow(id: string) {
    return {
      id,
      workflowId: 'workflow-1',
      deploymentVersionId: 'version-1',
      provider: 'github',
      providerConfig: {},
      archivedAt: null,
      createdAt: new Date('2026-07-14T08:00:00.000Z'),
    }
  }

  beforeEach(() => {
    mockIsDeploymentVersionActive.mockResolvedValue(false)
    mockIsDeploymentVersionProtected.mockResolvedValue(false)
  })

  it('retires one bounded batch of stale rows and reports the remainder', async () => {
    queueTableRows(webhook, [
      staleWebhookRow('wh-1'),
      staleWebhookRow('wh-2'),
      staleWebhookRow('wh-3'),
    ])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])

    await expect(cleanupInactiveDeploymentWebhooks({ ...input, limit: 2 })).resolves.toEqual({
      hasMore: true,
    })

    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wh-1' }),
      workflow,
      'request-1',
      { throwOnError: true }
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
  })

  it('excludes the version the current operation is preparing from the batch', async () => {
    queueTableRows(webhook, [])

    await expect(
      cleanupInactiveDeploymentWebhooks({ ...input, protectedDeploymentVersionId: 'version-3' })
    ).resolves.toEqual({ hasMore: false })

    expect(ne).toHaveBeenCalledWith(webhook.deploymentVersionId, 'version-3')
  })

  it('stops before any provider call once the fence reports a change', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])

    await expect(
      cleanupInactiveDeploymentWebhooks({ ...input, shouldContinue: async () => false })
    ).resolves.toEqual({ hasMore: true })

    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('leaves a row alone when its version was re-activated after the batch was selected', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    mockIsDeploymentVersionActive.mockResolvedValue(true)

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: true })

    expect(mockIsDeploymentVersionActive).toHaveBeenCalledWith('workflow-1', 'version-1')
    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
