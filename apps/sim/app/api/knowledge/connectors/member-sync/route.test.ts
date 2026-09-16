/** @vitest-environment node */
import {
  createMockRequest,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  dispatch: vi.fn(),
  workspaceBilling: vi.fn(),
  organizationBilling: vi.fn(),
  sweep: vi.fn(),
}))
vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mocks.auth }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mocks.workspaceBilling,
  resolveSystemOrganizationBillingAttribution: mocks.organizationBilling,
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  dispatchMemberSync: mocks.dispatch,
  QUEUEABLE_MEMBER_SYNC_STATUSES: ['idle', 'error'],
}))
vi.mock('@/lib/knowledge/connectors/member-observations', () => ({
  sweepStaleMemberObservations: mocks.sweep,
}))

import { GET } from '@/app/api/knowledge/connectors/member-sync/route'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.auth.mockReturnValue(null)
  mocks.dispatch.mockResolvedValue(undefined)
  mocks.sweep.mockResolvedValue({ members: 0 })
  mocks.workspaceBilling.mockResolvedValue({ workspaceId: 'workspace-a' })
  mocks.organizationBilling.mockResolvedValue({ workspaceId: null, organizationId: 'org-a' })
})

describe('member sync scheduler owner routing', () => {
  it('does not read or dispatch without cron authentication', async () => {
    mocks.auth.mockReturnValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(401)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

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
    expect(mocks.organizationBilling).toHaveBeenCalledExactlyOnceWith('org-a')
    expect(mocks.workspaceBilling).not.toHaveBeenCalled()
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith('org-source', {
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

  it('preserves workspace dispatch and refuses absent or ambiguous ownership', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'missing', workspaceId: null, organizationId: null },
      { id: 'ambiguous', workspaceId: 'workspace-a', organizationId: 'org-a' },
      { id: 'workspace-source', workspaceId: 'workspace-a', organizationId: null },
    ])
    await GET(createMockRequest('GET'))
    expect(mocks.organizationBilling).not.toHaveBeenCalled()
    expect(mocks.workspaceBilling).toHaveBeenCalledExactlyOnceWith('workspace-a')
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
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
    mocks.organizationBilling.mockRejectedValue(new Error('Organization payer unavailable'))
    const response = await GET(createMockRequest('GET'))
    expect(response.status).toBe(200)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.workspaceBilling).not.toHaveBeenCalled()
  })
})
