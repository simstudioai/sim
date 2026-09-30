import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountBillingDecision,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  authorizeCopilotChatCallback,
  checkCopilotContinuationBilling,
} from '@/lib/mothership/application/authorize-chat-callback'

const hoisted = vi.hoisted(() => ({
  capability: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/capability-assertions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/capability-assertions')>()),
  assertWorkspaceCapability: hoisted.capability,
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
const mockCheckAccountBillingBlocks = billingAttributionMockFns.mockCheckAccountBillingBlocks
const mockCheckAttributedBillingBlocks = billingAttributionMockFns.mockCheckAttributedBillingBlocks
const mocks = {
  ...hoisted,
  organization: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation,
  loadWorkspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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
  mockCheckAttributedBillingBlocks.mockResolvedValue({ blocked: false })
  mockCheckAccountBillingBlocks.mockResolvedValue({ blocked: false })
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
      'current-organization',
      undefined
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
  it('judges each run kind by its own block policy and original billing material', async () => {
    mockCheckAttributedBillingBlocks.mockImplementation(async (value: unknown) => ({
      blocked: value === attribution,
      scope: 'payer',
    }))
    mockCheckAccountBillingBlocks.mockImplementation(async (value: unknown) => ({
      blocked: value === account,
      scope: 'actor',
    }))

    await expect(
      checkCopilotContinuationBilling({ kind: 'attributed', attribution })
    ).resolves.toEqual({ blocked: true, scope: 'payer' })
    await expect(
      checkCopilotContinuationBilling({ kind: 'account', decision: account })
    ).resolves.toEqual({ blocked: true, scope: 'actor' })
  })
})
