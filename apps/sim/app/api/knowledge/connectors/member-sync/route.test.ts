import {
  createMockRequest,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  knowledgeMemberQueueMock,
  knowledgeMemberQueueMockFns,
} from '@sim/testing/mocks/knowledge-member-queue.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(),
}))
vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/knowledge/connectors/member-queue', () => knowledgeMemberQueueMock)
vi.mock('@/lib/knowledge/connectors/member-observations', () => ({
  sweepStaleMemberObservations: mocks.sweep,
}))

import { GET } from '@/app/api/knowledge/connectors/member-sync/route'

const { mockVerifyCronAuth } = authInternalMockFns

const mockDispatchMemberSync = knowledgeMemberQueueMockFns.mockDispatchMemberSync

beforeEach(() => {
  resetDbChainMock()
  mockVerifyCronAuth.mockReturnValue(null)
  mockDispatchMemberSync.mockResolvedValue(undefined)
  mocks.sweep.mockResolvedValue({ members: 0 })
  billingAttributionMockFns.mockResolveSystemBillingAttribution.mockResolvedValue({
    workspaceId: 'workspace-a',
  })
  billingAttributionMockFns.mockResolveSystemOrganizationBillingAttribution.mockResolvedValue({
    workspaceId: null,
    organizationId: 'org-a',
  })
})

describe('member sync scheduler owner routing', () => {
  it('projects org ownership and dispatches with its actual system payer', async () => {
    const nextMemberSyncAt = new Date('2026-09-01T00:00:00Z')
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'org-source', workspaceId: null, organizationId: 'org-a', nextMemberSyncAt },
    ])
    await GET(createMockRequest('GET'))
    expect(dbChainMockFns.select).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: schemaMock.knowledgeBase.workspaceId,
        organizationId: schemaMock.knowledgeBase.organizationId,
      })
    )
    expect(
      billingAttributionMockFns.mockResolveSystemOrganizationBillingAttribution
    ).toHaveBeenCalledExactlyOnceWith('org-a')
    expect(billingAttributionMockFns.mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockDispatchMemberSync).toHaveBeenCalledExactlyOnceWith('org-source', {
      billingAttribution: { workspaceId: null, organizationId: 'org-a' },
      expectedNextMemberSyncAt: nextMemberSyncAt,
      requestId: expect.any(String),
      requireRunnable: true,
    })
    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        where,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.accessMode &&
          node.right === 'members'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.deletedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.deletedAt
      )
    ).toBe(true)
  })

  it('still dispatches due connectors when the stale observation sweep fails', async () => {
    mocks.sweep.mockRejectedValue(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'workspace-source', workspaceId: 'workspace-a', organizationId: null },
    ])
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(200)
    expect(mockDispatchMemberSync).toHaveBeenCalledExactlyOnceWith(
      'workspace-source',
      expect.objectContaining({ requireRunnable: true })
    )
  })

  it('preserves workspace dispatch and refuses absent or ambiguous ownership', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'missing', workspaceId: null, organizationId: null },
      { id: 'ambiguous', workspaceId: 'workspace-a', organizationId: 'org-a' },
      { id: 'workspace-source', workspaceId: 'workspace-a', organizationId: null },
    ])
    await GET(createMockRequest('GET'))
    expect(
      billingAttributionMockFns.mockResolveSystemOrganizationBillingAttribution
    ).not.toHaveBeenCalled()
    expect(
      billingAttributionMockFns.mockResolveSystemBillingAttribution
    ).toHaveBeenCalledExactlyOnceWith('workspace-a')
    expect(mockDispatchMemberSync).toHaveBeenCalledExactlyOnceWith(
      'workspace-source',
      expect.objectContaining({
        billingAttribution: { workspaceId: 'workspace-a' },
        requireRunnable: true,
      })
    )
  })

  it('does not enqueue an org source when its payer cannot be resolved', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'org-source', workspaceId: null, organizationId: 'org-a' },
    ])
    billingAttributionMockFns.mockResolveSystemOrganizationBillingAttribution.mockRejectedValue(
      new Error('Organization payer unavailable')
    )
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(200)
    expect(mockDispatchMemberSync).not.toHaveBeenCalled()
    expect(billingAttributionMockFns.mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })
})
