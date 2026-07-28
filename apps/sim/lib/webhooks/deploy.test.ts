/**
 * @vitest-environment node
 */
import { account, credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

// deploy.ts pulls in the trigger/block/provider registries at module load; none are exercised by
// buildProviderConfig (a pure function), so stub them to keep this unit test fast and isolated.
vi.mock('@/blocks', () => ({ getBlock: vi.fn() }))
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

const {
  mockGetSlackBotCredential,
  mockResolveOAuthAccountId,
  mockRefreshAccessTokenIfNeeded,
  mockFetchSlackTeamId,
} = vi.hoisted(() => ({
  mockGetSlackBotCredential: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockFetchSlackTeamId: vi.fn(),
}))
vi.mock('@/app/api/auth/oauth/utils', () => ({
  getSlackBotCredential: mockGetSlackBotCredential,
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))
vi.mock('@/lib/webhooks/providers/slack', () => ({
  fetchSlackTeamId: mockFetchSlackTeamId,
}))

import {
  buildProviderConfig,
  resolveTriggerCredentialId,
  resolveWebhookConfigForBlock,
} from '@/lib/webhooks/deploy'
import { getBlock } from '@/blocks'
import { getTrigger } from '@/triggers'

afterAll(resetDbChainMock)

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
      workflow,
      userId: 'deployer-1',
      requestId: 'req-1',
    })
  }

  it('routes a custom bot credential by credential id on the slack provider', async () => {
    mockGetSlackBotCredential.mockResolvedValue({ workspaceId: 'ws-1', botUserId: 'BUSER' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(true)
    if (!result?.success) throw new Error('expected success')
    expect(result.config.provider).toBe('slack')
    expect(result.config.routingKey).toBe('cred_bot_1')
    expect(result.config.triggerPath).toBeNull()
    expect(result.config.providerConfig.bot_user_id).toBe('BUSER')
  })

  it('rejects a custom bot credential from another workspace', async () => {
    mockGetSlackBotCredential.mockResolvedValue({ workspaceId: 'other-ws', botUserId: 'BUSER' })

    const result = await resolveSlack({ eventType: 'message', customBotCredential: 'cred_bot_1' })

    expect(result?.success).toBe(false)
    if (result?.success) throw new Error('expected failure')
    expect(result?.error?.status).toBe(400)
    expect(result?.error?.message).toContain('not available in this workspace')
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
