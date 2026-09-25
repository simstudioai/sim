import {
  createMockRequest,
  flattenMockConditions,
  hasMockCondition,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatch } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/knowledge/connectors/directory-queue', () => ({
  dispatchDirectorySync: mockDispatch,
}))

import { GET } from '@/app/api/knowledge/connectors/directory-sync/route'

const { mockVerifyCronAuth } = authInternalMockFns
mockVerifyCronAuth.mockImplementation(() => null)

const mockClaim = dbChainMockFns.returning
const mockConnectorRows = dbChainMockFns.limit
const mockWhere = dbChainMockFns.where

function connector(overrides: Record<string, unknown> = {}) {
  return { id: 'connector-1', nextDirectorySyncAt: new Date(0), ...overrides }
}

async function run() {
  const response = await GET(createMockRequest('GET'))
  return response.json()
}

describe('connector directory sync scheduler', () => {
  beforeEach(() => {
    resetEnvFlagsMock()
    mockVerifyCronAuth.mockReturnValue(null)
    mockDispatch.mockResolvedValue(undefined)
    mockClaim.mockResolvedValue([{ id: 'connector-1' }])
  })

  it('includes either canonical owner while retaining mirrored-source eligibility', async () => {
    mockConnectorRows.mockResolvedValue([connector({ id: 'org-source' })])
    await run()
    const condition = mockWhere.mock.calls[0][0]
    const ownerChoice = flattenMockConditions(condition).find((entry) => entry.type === 'or')
    expect(ownerChoice).toBeDefined()
    expect(ownerChoice?.conditions).toHaveLength(2)
    const [workspaceOwner, organizationOwner] = Array.isArray(ownerChoice?.conditions)
      ? ownerChoice.conditions
      : []
    expect(
      hasMockCondition(
        workspaceOwner,
        (node) => node.type === 'isNotNull' && node.column === schemaMock.knowledgeBase.workspaceId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        workspaceOwner,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.organizationId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        organizationOwner,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.workspaceId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        organizationOwner,
        (node) =>
          node.type === 'isNotNull' && node.column === schemaMock.knowledgeBase.organizationId
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.deletedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node) => node.type === 'isNull' && node.column === schemaMock.knowledgeBase.deletedAt
      )
    ).toBe(true)
    expect(mockDispatch).toHaveBeenCalledExactlyOnceWith('org-source', expect.anything())
  })

  it('contains a dispatch failure to the connector that caused it', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])
    mockDispatch.mockRejectedValueOnce(new Error('queue unreachable'))

    await expect(run()).resolves.toMatchObject({ dispatched: 1, failed: 1 })
  })

  it.each([true, false])(
    'excludes Search directories from scheduled pages only when live Search is %s',
    async (liveSearch) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: liveSearch })
      mockConnectorRows.mockResolvedValue([])
      await run()
      expect(
        hasMockCondition(
          mockWhere.mock.calls[0][0],
          (node) =>
            node.type === 'eq' &&
            node.left === schemaMock.knowledgeBase.isSearchIndex &&
            node.right === false
        )
      ).toBe(liveSearch)
    }
  )

  it('does not enqueue a connector another scheduler claimed or paused', async () => {
    mockConnectorRows.mockResolvedValue([connector()])
    mockClaim.mockResolvedValueOnce([])
    await expect(run()).resolves.toMatchObject({ considered: 1, dispatched: 0, failed: 0 })
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
