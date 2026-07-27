/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAsc, mockCredentialExpression, mockEq, mockGt, mockLike, tables } = vi.hoisted(() => ({
  mockAsc: vi.fn((value: unknown) => ({ asc: value })),
  mockCredentialExpression: vi.fn(() => 'webhook.credentialId'),
  mockEq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  mockGt: vi.fn((left: unknown, right: unknown) => ({ gt: [left, right] })),
  mockLike: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  /** Table-qualified column names keep the eq/like assertions unambiguous. */
  tables: {
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
  asc: mockAsc,
  eq: mockEq,
  gt: mockGt,
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
  like: mockLike,
  or: vi.fn((...conditions: unknown[]) => conditions),
}))

import {
  findTikTokWebhookTargetPage,
  TIKTOK_WEBHOOK_TARGET_PAGE_SIZE,
} from '@/background/tiktok-webhook-targets'

const ACCOUNT_UUID = '11111111-2222-3333-4444-555555555555'

/** Queues one page of joined rows, clipped like the SQL LIMIT would. */
function queuePageRows(
  rows: Array<{
    accountId: string
    webhookId: string
    webhook: Record<string, unknown>
    workflow: Record<string, unknown>
  }>
) {
  queueTableRows(tables.account, rows.slice(0, TIKTOK_WEBHOOK_TARGET_PAGE_SIZE))
}

describe('findTikTokWebhookTargetPage', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns only rows whose stored account ID exactly matches user_openid', async () => {
    queuePageRows([
      {
        accountId: `act.user-${ACCOUNT_UUID}`,
        webhookId: 'webhook-1',
        webhook: { id: 'webhook-1' },
        workflow: { id: 'workflow-1' },
      },
      {
        accountId: `act.user-other-${ACCOUNT_UUID}`,
        webhookId: 'webhook-2',
        webhook: { id: 'webhook-2' },
        workflow: { id: 'workflow-2' },
      },
    ])

    const page = await findTikTokWebhookTargetPage('act.user', 'request-1')

    expect(page).toEqual({
      hasMore: false,
      nextCursor: 'webhook-2',
      targets: [
        {
          webhook: { id: 'webhook-1' },
          workflow: { id: 'workflow-1' },
        },
      ],
    })
  })

  it('enforces provider and workspace bindings in the database query', async () => {
    await findTikTokWebhookTargetPage('act.user', 'request-2')

    expect(mockEq).toHaveBeenCalledWith('credential.providerId', 'tiktok')
    expect(mockEq).toHaveBeenCalledWith('webhook.provider', 'tiktok')
    expect(mockEq).toHaveBeenCalledWith('workflow.workspaceId', 'credential.workspaceId')
    expect(mockCredentialExpression).toHaveBeenCalledWith('webhook.providerConfig')
    expect(mockEq).toHaveBeenCalledWith('webhook.credentialId', 'credential.id')
  })

  it('uses a fixed-size webhook ID keyset in ascending order', async () => {
    await findTikTokWebhookTargetPage('act.user', 'request-3', 'webhook-100')

    expect(mockGt).toHaveBeenCalledWith('webhook.id', 'webhook-100')
    expect(mockAsc).toHaveBeenCalledWith('webhook.id')
    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith({ asc: 'webhook.id' })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(TIKTOK_WEBHOOK_TARGET_PAGE_SIZE)
  })

  it('returns a continuation cursor when the fixed-size page is full', async () => {
    queuePageRows(
      Array.from({ length: TIKTOK_WEBHOOK_TARGET_PAGE_SIZE + 1 }, (_, index) => {
        const webhookId = `webhook-${String(index).padStart(3, '0')}`
        return {
          accountId: `act.user-${ACCOUNT_UUID}`,
          webhookId,
          webhook: { id: webhookId },
          workflow: { id: `workflow-${index}` },
        }
      })
    )

    const page = await findTikTokWebhookTargetPage('act.user', 'request-4')

    expect(page.targets).toHaveLength(TIKTOK_WEBHOOK_TARGET_PAGE_SIZE)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('webhook-099')
  })

  it('escapes user_openid wildcard characters in the account lookup', async () => {
    await findTikTokWebhookTargetPage('act_%', 'request-5')

    expect(mockLike).toHaveBeenCalledWith(
      'account.accountId',
      'act\\_\\%-________-____-____-____-____________'
    )
  })

  it('does not query for an empty user_openid', async () => {
    expect(await findTikTokWebhookTargetPage('', 'request-6')).toEqual({
      hasMore: false,
      nextCursor: null,
      targets: [],
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
