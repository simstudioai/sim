/**
 * @vitest-environment node
 */
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
  vi.clearAllMocks()
  resetDbChainMock()
  setEnv({ SLACK_SIGNING_SECRET: 'test-secret' })
  setEnvFlags({ isSlackExtendedScopesEnabled: true })
  ;(getProviderHandler as unknown as Mock).mockImplementation((provider: string) =>
    provider === 'quickbooks' ? quickBooksHandler : {}
  )
})

describe('buildProviderConfig canonical collapse', () => {
  it('writes the basic value under the canonical key in basic mode', () => {
    const block = makeBlock('google_drive_poller', { folderId: 'BASIC' })
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBe('BASIC')
  })

  it('returns the credential reference and OAuth service for deploy validation', () => {
    const block = makeBlock('google_drive_poller', { triggerCredentials: 'credential-1' })
    const result = buildProviderConfig(block, 'google_drive_poller', driveTrigger)

    expect(result.credentialReference).toBe('credential-1')
    expect(result.credentialServiceId).toBe('google-drive')
    expect(result.providerConfig.credentialId).toBeUndefined()
  })

  it('writes the active (advanced) value under the canonical key when only advanced is set', () => {
    const block = makeBlock('google_drive_poller', { manualFolderId: 'ADVANCED' })
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    // Heuristic: empty basic + populated advanced => advanced is active.
    expect(providerConfig.folderId).toBe('ADVANCED')
    // Raw advanced key kept for transitional readers.
    expect(providerConfig.manualFolderId).toBe('ADVANCED')
  })

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

  it('writes a distinct canonical key (tableId) for the table trigger', () => {
    const block = makeBlock('table_new_row', { tableSelector: 'TBL' })
    const { providerConfig } = buildProviderConfig(block, 'table_new_row', tableTrigger)
    expect(providerConfig.tableId).toBe('TBL')
    // Raw basic key kept for transitional readers.
    expect(providerConfig.tableSelector).toBe('TBL')
  })

  it('collapses a drift table block to the active value under tableId', () => {
    const block = makeBlock(
      'table_new_row',
      { tableSelector: 'STALE', manualTableId: 'ACTIVE' },
      { tableId: 'advanced' }
    )
    const { providerConfig } = buildProviderConfig(block, 'table_new_row', tableTrigger)
    expect(providerConfig.tableId).toBe('ACTIVE')
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

  it('routes a custom bot credential without the native app signing secret', async () => {
    setEnvFlags({ isSlackExtendedScopesEnabled: false })
    setEnv({ SLACK_SIGNING_SECRET: undefined })
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-token',
      teamId: 'T123',
      botUserId: 'BUSER',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.bot_user_id).toBe('BUSER')
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
  })

  it('deploys a slash command trigger and preserves its command filter', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-token',
      teamId: 'T123',
      botUserId: 'BUSER',
      signingSecret: 'secret',
    })

    const result = await resolveSlack({
      eventType: 'slash_command',
      commandFilter: '/ask-sim',
      customBotCredential: 'cred_bot_1',
    })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.providerConfig).toMatchObject({
      eventType: 'slash_command',
      commandFilter: '/ask-sim',
    })
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

  it('resolves missing bot identity for reaction events even when team identity is stored', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botToken: 'xoxb-migrated',
      teamId: 'T123',
      signingSecret: 'secret',
    })
    mockFetchSlackTeamId.mockResolvedValue({ teamId: 'T123', userId: 'UBOT' })

    const result = await resolveSlack({
      eventType: 'reaction_added',
      customBotCredential: 'cred_bot_1',
    })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.providerConfig.bot_user_id).toBe('UBOT')
    expect(mockFetchSlackTeamId).toHaveBeenCalledWith('xoxb-migrated')
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

  it('rejects a Sim-app credential when its signing secret is not configured', async () => {
    setEnv({ SLACK_SIGNING_SECRET: undefined })
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_oauth_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error).toEqual({
      message:
        'The Sim Slack app trigger is not configured for this deployment. Configure its signing secret or select a custom bot.',
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

  it('rejects an action-only custom bot that has no signing secret', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      workspaceId: 'ws-1',
      botUserId: 'BUSER',
      botToken: 'xoxb-token',
    })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error).toEqual({
      message:
        'The selected Slack bot can run actions but cannot receive events because it has no signing secret. Reconnect it with a signing secret.',
      status: 400,
    })
  })

  it('rejects a deleted or secretless custom bot credential as an invalid bot', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ credentialType: 'service_account' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_x' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('bot credential is missing or invalid')
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
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

  it('rejects Agent Sessions events on the native Sim app', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })
    queueTableRows(credential, [{ id: 'cred_oauth_1' }])

    const result = await resolveSlack({
      eventType: 'agent_session_stopped',
      customBotCredential: 'cred_oauth_1',
    })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error).toEqual({
      message:
        'This event is not available on the Sim Slack app. Use a custom bot or choose a supported event.',
      status: 400,
    })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
  })

  it('routes an OAuth account by team_id on the slack_app provider', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'acct-1' })
    queueTableRows(credential, [{ id: 'cred_oauth_1' }])
    queueTableRows(account, [{ userId: 'owner-1' }])
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('xoxb-token')
    mockFetchSlackTeamId.mockResolvedValue({ teamId: 'T123', userId: 'UBOT' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_oauth_1' })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack_app')
    expect(result.config.routingKey).toBe('T123')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.bot_user_id).toBe('UBOT')
    // Runtime token resolution + disconnect cleanup key slack_app rows on this.
    expect(result.config.providerConfig.credentialId).toBe('cred_oauth_1')
    // Owner's token, not the deploying actor's.
    expect(mockRefreshAccessTokenIfNeeded).toHaveBeenCalledWith('cred_oauth_1', 'owner-1', 'req-1')
  })

  it('fails when the connected Slack account token cannot be resolved', async () => {
    mockGetSlackBotCredential.mockResolvedValue(null)
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: '' })
    queueTableRows(credential, [{ id: 'cred_oauth_1' }])
    mockRefreshAccessTokenIfNeeded.mockResolvedValue(null)

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_oauth_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('Could not access the connected Slack account')
    expect(mockFetchSlackTeamId).not.toHaveBeenCalled()
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

  it('leaves an unmigrated legacy trigger on direct path dispatch', async () => {
    const result = await resolveLegacySlack({
      signingSecret: 'legacy-secret',
      botToken: 'legacy-token',
      triggerPath: 'legacy-path',
    })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.triggerPath).toBe('legacy-path')
    expect(result.config.routingKey).toBeNull()
    expect(result.config.providerConfig.credentialId).toBeUndefined()
    expect(result.config.providerConfig.ingressMode).toBeUndefined()
    expect(mockGetSlackBotCredential).not.toHaveBeenCalled()
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

  it('routes a canonical workspace credential by its TikTok open_id', async () => {
    queueTableRows(credential, [{ id: 'credential-1' }])
    mockResolveOAuthAccountId.mockResolvedValue({ accountId: 'account-1' })
    queueTableRows(account, [
      { accountId: 'open-id-with-hyphens-12345678-1234-1234-1234-123456789abc' },
    ])

    const result = await resolveTikTok()

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('tiktok')
    expect(result.config.routingKey).toBe('open-id-with-hyphens')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.credentialId).toBe('credential-1')
  })

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

  it('routes a workspace-owned credential by its stored QuickBooks realm ID', async () => {
    queueTableRows(credential, [{ id: 'cred-qb-1' }])
    mockGetQuickBooksWebhookCredential.mockResolvedValue({
      clientConfig: { webhookVerifierToken: 'verifier' },
      identity: { appKey: 'app-key', realmId: '9341456000000000' },
    })

    const result = await resolveQuickBooks('cred-qb-1')

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('quickbooks')
    expect(result.config.routingKey).toBe('app-key:9341456000000000')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.credentialId).toBe('cred-qb-1')
    expect(result.config.providerConfig.quickBooksWebhookAppKey).toBe('app-key')
  })

  it('rejects a QuickBooks credential outside the workflow workspace', async () => {
    const result = await resolveQuickBooks('cred-foreign')

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.message).toContain('not available in this workspace')
    expect(mockGetQuickBooksWebhookCredential).not.toHaveBeenCalled()
  })

  it('rejects a malformed stored QuickBooks company identity', async () => {
    queueTableRows(credential, [{ id: 'cred-qb-1' }])
    mockGetQuickBooksWebhookCredential.mockResolvedValue(null)

    const result = await resolveQuickBooks('cred-qb-1')

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.message).toContain('Reconnect it and try again')
  })

  it('reports an unexpected credential lookup failure as a server error', async () => {
    queueTableRows(credential, [{ id: 'cred-qb-1' }])
    mockGetQuickBooksWebhookCredential.mockRejectedValue(new Error('database unavailable'))

    const result = await resolveQuickBooks('cred-qb-1')

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error.status).toBe(500)
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

  it('reports completion once the batch drains every stale row', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: false })

    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
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

  it('leaves a row alone when its version became the current candidate mid-batch', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    mockIsDeploymentVersionProtected.mockResolvedValue(true)

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: true })

    expect(mockIsDeploymentVersionProtected).toHaveBeenCalledWith('workflow-1', 'version-1')
    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
