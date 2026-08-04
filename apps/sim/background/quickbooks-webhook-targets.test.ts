/** @vitest-environment node */

import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCredentialExpression, mockEq, mockGt, tables } = vi.hoisted(() => ({
  mockCredentialExpression: vi.fn(() => 'webhook.credentialId'),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  mockGt: vi.fn((left: unknown, right: unknown) => ({ gt: [left, right] })),
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
      deploymentVersionId: 'webhook.deploymentVersionId',
      isActive: 'webhook.isActive',
      id: 'webhook.id',
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
  },
}))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  ...tables,
  webhookCredentialIdExpression: mockCredentialExpression,
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  asc: vi.fn((value: unknown) => ({ asc: value })),
  eq: mockEq,
  gt: mockGt,
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
  like: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  or: vi.fn((...conditions: unknown[]) => conditions),
}))

import {
  findQuickBooksWebhookTargetPage,
  QUICKBOOKS_WEBHOOK_TARGET_PAGE_SIZE,
} from '@/background/quickbooks-webhook-targets'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('findQuickBooksWebhookTargetPage', () => {
  afterAll(resetDbChainMock)
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns only the exact company identity and enforces provider/workspace bindings', async () => {
    queueTableRows(tables.account, [
      {
        accountId: `quickbooks:456:user-${UUID}`,
        webhookId: 'webhook-1',
        webhook: { id: 'webhook-1' },
        workflow: { id: 'workflow-1' },
      },
      {
        accountId: `quickbooks:789:user-${UUID}`,
        webhookId: 'webhook-2',
        webhook: { id: 'webhook-2' },
        workflow: { id: 'workflow-2' },
      },
    ])

    const page = await findQuickBooksWebhookTargetPage('456', 'request-1')
    expect(page.targets).toEqual([{ webhook: { id: 'webhook-1' }, workflow: { id: 'workflow-1' } }])
    expect(mockEq).toHaveBeenCalledWith('credential.providerId', 'quickbooks')
    expect(mockEq).toHaveBeenCalledWith('webhook.provider', 'quickbooks')
    expect(mockEq).toHaveBeenCalledWith('workflow.workspaceId', 'credential.workspaceId')
  })

  it('uses a fixed 100-target keyset page', async () => {
    await findQuickBooksWebhookTargetPage('456', 'request-2', 'webhook-100')
    expect(mockGt).toHaveBeenCalledWith('webhook.id', 'webhook-100')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(QUICKBOOKS_WEBHOOK_TARGET_PAGE_SIZE)
  })
})
