/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCredentialExpression, mockEq, mockSelect, queryRows } = vi.hoisted(() => ({
  mockCredentialExpression: vi.fn(() => 'webhook.credentialId'),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  mockSelect: vi.fn(),
  queryRows: {
    rows: [] as Array<{
      accountId: string
      webhook: Record<string, unknown>
      workflow: Record<string, unknown>
    }>,
  },
}))

vi.mock('@sim/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(queryRows.rows)),
  }
  mockSelect.mockImplementation(() => chain)

  return {
    account: {
      id: 'account.id',
      accountId: 'account.accountId',
      providerId: 'account.providerId',
    },
    credential: {
      id: 'credential.id',
      accountId: 'credential.accountId',
      providerId: 'credential.providerId',
      type: 'credential.type',
      workspaceId: 'credential.workspaceId',
    },
    db: { select: mockSelect },
    webhookCredentialIdExpression: mockCredentialExpression,
    webhook: {
      deploymentVersionId: 'webhook.deploymentVersionId',
      isActive: 'webhook.isActive',
      archivedAt: 'webhook.archivedAt',
      provider: 'webhook.provider',
      providerConfig: 'webhook.providerConfig',
      workflowId: 'webhook.workflowId',
    },
    workflow: {
      id: 'workflow.id',
      workspaceId: 'workflow.workspaceId',
      archivedAt: 'workflow.archivedAt',
    },
    workflowDeploymentVersion: {
      id: 'workflowDeploymentVersion.id',
      workflowId: 'workflowDeploymentVersion.workflowId',
      isActive: 'workflowDeploymentVersion.isActive',
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: mockEq,
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
  like: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  or: vi.fn((...conditions: unknown[]) => conditions),
}))

import { findTikTokWebhookTargets } from '@/lib/webhooks/providers/tiktok-targets'

describe('findTikTokWebhookTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRows.rows = []
  })

  it('returns only rows whose stored account ID exactly matches user_openid', async () => {
    queryRows.rows = [
      {
        accountId: 'act.user-11111111-2222-3333-4444-555555555555',
        webhook: { id: 'webhook-1' },
        workflow: { id: 'workflow-1' },
      },
      {
        accountId: 'act.user-other-11111111-2222-3333-4444-555555555555',
        webhook: { id: 'webhook-2' },
        workflow: { id: 'workflow-2' },
      },
    ]

    const targets = await findTikTokWebhookTargets('act.user', 'request-1')

    expect(targets).toEqual([
      {
        webhook: { id: 'webhook-1' },
        workflow: { id: 'workflow-1' },
      },
    ])
  })

  it('enforces provider and workspace bindings in the database query', async () => {
    await findTikTokWebhookTargets('act.user', 'request-2')

    expect(mockEq).toHaveBeenCalledWith('credential.providerId', 'tiktok')
    expect(mockEq).toHaveBeenCalledWith('webhook.provider', 'tiktok')
    expect(mockEq).toHaveBeenCalledWith('workflow.workspaceId', 'credential.workspaceId')
    expect(mockCredentialExpression).toHaveBeenCalledWith('webhook.providerConfig')
    expect(mockEq).toHaveBeenCalledWith('webhook.credentialId', 'credential.id')
  })

  it('does not query for an empty user_openid', async () => {
    expect(await findTikTokWebhookTargets('', 'request-3')).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
