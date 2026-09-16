/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountBillingDecision,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import {
  authorizeCopilotChatCallback,
  checkCopilotContinuationBilling,
} from '@/lib/copilot/application/authorize-chat-callback'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  permission: vi.fn(),
  capability: vi.fn(),
  organization: vi.fn(),
  attributedBlocks: vi.fn(),
  actorBlock: vi.fn(),
  payerBlock: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/capability-assertions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/capability-assertions')>()),
  assertWorkspaceCapability: mocks.capability,
}))
vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: mocks.organization },
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedBillingBlocks: mocks.attributedBlocks,
}))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkBillingBlocked: mocks.actorBlock,
  checkBillingEntityBlocked: mocks.payerBlock,
}))

const context = {
  userId: 'actor',
  workspaceId: 'workspace',
  chatId: 'chat',
  delegationId: 'request',
  purpose: 'continuation' as const,
}
const account: AccountBillingDecision = {
  userId: 'actor',
  billingEntity: { type: 'organization', id: 'original-payer' },
  billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
}
const attribution: BillingAttributionSnapshot = {
  actorUserId: 'actor',
  billedAccountUserId: 'owner',
  workspaceId: 'workspace',
  organizationId: 'original-payer',
  billingEntity: account.billingEntity,
  billingPeriod: account.billingPeriod,
  payerSubscription: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.loadWorkspace.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: 'current-organization',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'new-owner',
  })
  mocks.permission.mockResolvedValue('read')
  mocks.organization.mockResolvedValue(undefined)
  mocks.actorBlock.mockResolvedValue({ blocked: false })
  mocks.payerBlock.mockResolvedValue({ blocked: false })
  mocks.attributedBlocks.mockResolvedValue({ blocked: false })
})

describe('fresh chat callback authorization', () => {
  it('checks the actor current membership and capability in the canonical workspace', async () => {
    await authorizeCopilotChatCallback(context)
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace')
    expect(mocks.permission).toHaveBeenCalledWith(
      'actor',
      'workspace',
      'current-organization',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.capability).toHaveBeenCalledWith(
      'actor',
      'workspace',
      'copilot.use',
      'current-organization'
    )
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capability.mock.invocationCallOrder[0]
    )
  })

  it.each(['continuation', 'cancellation'] as const)(
    'rejects removed membership on %s',
    async (purpose) => {
      mocks.permission.mockResolvedValueOnce(null)
      await expect(authorizeCopilotChatCallback({ ...context, purpose })).rejects.toMatchObject({
        code: 'forbidden',
      })
      expect(mocks.capability).not.toHaveBeenCalled()
    }
  )

  it.each(['continuation', 'cancellation'] as const)(
    'rejects an archived or removed workspace on %s',
    async (purpose) => {
      mocks.loadWorkspace.mockRejectedValueOnce(
        new OrchestrationError('not_found', 'Workspace not found')
      )
      await expect(authorizeCopilotChatCallback({ ...context, purpose })).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(mocks.permission).not.toHaveBeenCalled()
    }
  )

  it('rejects continuation after capability revocation, but allows the actor to stop', async () => {
    mocks.capability.mockRejectedValue(new OrchestrationError('forbidden', 'Copilot disabled'))
    await expect(authorizeCopilotChatCallback(context)).rejects.toMatchObject({ code: 'forbidden' })
    mocks.capability.mockClear()
    await authorizeCopilotChatCallback({ ...context, purpose: 'cancellation' })
    expect(mocks.permission).toHaveBeenCalledTimes(2)
    expect(mocks.capability).not.toHaveBeenCalled()
  })

  it('fails closed if canonical workspace scope changes unexpectedly', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce({
      workspaceId: 'other-workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    await expect(authorizeCopilotChatCallback(context)).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it('propagates membership infrastructure failures', async () => {
    mocks.permission.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(authorizeCopilotChatCallback(context)).rejects.toThrow('database unavailable')
  })

  it.each([
    ['continuation', 'sim:copilot-billing'],
    ['cancellation', 'sim:copilot-cancel'],
  ] as const)(
    'reauthorizes the original private organization chat for %s',
    async (purpose, audience) => {
      await authorizeCopilotChatCallback({
        ...context,
        workspaceId: undefined,
        organizationId: 'org',
        purpose,
      })
      expect(mocks.organization).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          kind: 'organization_delegated',
          subjectUserId: 'actor',
          organizationId: 'org',
          audience,
          resourceScope: { chatId: 'chat' },
        }),
      })
      expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each([
    { workspaceId: undefined, organizationId: 'org', chatId: undefined },
    { workspaceId: 'workspace', organizationId: 'org', chatId: 'chat' },
  ])('refuses invalid organization scope %s', async (scope) => {
    await expect(authorizeCopilotChatCallback({ ...context, ...scope })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.organization).not.toHaveBeenCalled()
  })
})

describe('continuation account standing', () => {
  it('uses the existing attributed block policy with the original snapshot', async () => {
    await checkCopilotContinuationBilling({ kind: 'attributed', attribution })
    expect(mocks.attributedBlocks).toHaveBeenCalledWith(attribution)
    expect(mocks.actorBlock).not.toHaveBeenCalled()
    expect(mocks.payerBlock).not.toHaveBeenCalled()
  })

  it('checks both actor and the exact original direct-account payer', async () => {
    await checkCopilotContinuationBilling({ kind: 'account', decision: account })
    expect(mocks.actorBlock).toHaveBeenCalledWith('actor')
    expect(mocks.payerBlock).toHaveBeenCalledWith({ type: 'organization', id: 'original-payer' })
  })

  it('refuses an actor block before reading the payer', async () => {
    mocks.actorBlock.mockResolvedValueOnce({ blocked: true })
    await expect(
      checkCopilotContinuationBilling({ kind: 'account', decision: account })
    ).resolves.toMatchObject({ blocked: true, scope: 'actor' })
    expect(mocks.payerBlock).not.toHaveBeenCalled()
  })

  it('refuses a payer block independently of actor standing', async () => {
    mocks.payerBlock.mockResolvedValueOnce({ blocked: true })
    await expect(
      checkCopilotContinuationBilling({ kind: 'account', decision: account })
    ).resolves.toMatchObject({ blocked: true, scope: 'payer' })
  })

  it('reads the same personal actor/payer only once', async () => {
    await checkCopilotContinuationBilling({
      kind: 'account',
      decision: { ...account, billingEntity: { type: 'user', id: 'actor' } },
    })
    expect(mocks.actorBlock).toHaveBeenCalledTimes(1)
    expect(mocks.payerBlock).not.toHaveBeenCalled()
  })
})
