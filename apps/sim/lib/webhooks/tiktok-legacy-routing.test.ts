/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCredentialExpression, mockEq, mockIsNull, mockLike, tables } = vi.hoisted(() => ({
  mockCredentialExpression: vi.fn(() => 'webhook.credentialId'),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  mockIsNull: vi.fn((value: unknown) => ({ isNull: value })),
  mockLike: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  tables: {
    account: { id: 'account.id', accountId: 'account.accountId', providerId: 'account.providerId' },
    credential: {
      id: 'credential.id',
      accountId: 'credential.accountId',
      providerId: 'credential.providerId',
      type: 'credential.type',
      workspaceId: 'credential.workspaceId',
    },
    webhook: {
      archivedAt: 'webhook.archivedAt',
      deploymentVersionId: 'webhook.deploymentVersionId',
      isActive: 'webhook.isActive',
      provider: 'webhook.provider',
      providerConfig: 'webhook.providerConfig',
      routingKey: 'webhook.routingKey',
      workflowId: 'webhook.workflowId',
    },
    workflow: {
      archivedAt: 'workflow.archivedAt',
      id: 'workflow.id',
      workspaceId: 'workflow.workspaceId',
    },
    workflowDeploymentVersion: {
      id: 'workflowDeploymentVersion.id',
      isActive: 'workflowDeploymentVersion.isActive',
      workflowId: 'workflowDeploymentVersion.workflowId',
    },
  },
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  ...tables,
  webhookCredentialIdExpression: mockCredentialExpression,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: mockEq,
  isNull: mockIsNull,
  like: mockLike,
  or: vi.fn((...conditions: unknown[]) => conditions),
}))

import { findLegacyTikTokWebhooks } from '@/lib/webhooks/tiktok-legacy-routing'

const ACCOUNT_UUID = '11111111-2222-3333-4444-555555555555'

describe('findLegacyTikTokWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns only the exact legacy account match and enforces tenant routing constraints', async () => {
    queueTableRows(tables.account, [
      {
        accountId: `act.user-${ACCOUNT_UUID}`,
        webhook: { id: 'webhook-1' },
        workflow: { id: 'workflow-1' },
      },
      {
        accountId: `act.user-other-${ACCOUNT_UUID}`,
        webhook: { id: 'webhook-2' },
        workflow: { id: 'workflow-2' },
      },
    ])

    await expect(findLegacyTikTokWebhooks('act.user')).resolves.toEqual([
      { webhook: { id: 'webhook-1' }, workflow: { id: 'workflow-1' } },
    ])
    expect(mockEq).toHaveBeenCalledWith('workflow.workspaceId', 'credential.workspaceId')
    expect(mockEq).toHaveBeenCalledWith('webhook.provider', 'tiktok')
    expect(mockIsNull).toHaveBeenCalledWith('webhook.routingKey')
    expect(mockLike).toHaveBeenCalledWith(
      'account.accountId',
      'act.user-________-____-____-____-____________'
    )
  })

  it('does not query for an empty open ID', async () => {
    await expect(findLegacyTikTokWebhooks('')).resolves.toEqual([])
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
