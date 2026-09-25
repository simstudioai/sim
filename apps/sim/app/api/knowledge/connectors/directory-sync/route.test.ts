import {
  createMockRequest,
  flattenMockConditions,
  hasMockCondition,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockConnectorRows, mockDispatch, mockClaim, mockWhere } = vi.hoisted(
  () => ({
    mockVerifyCronAuth: vi.fn(() => null),
    mockConnectorRows: vi.fn(),
    mockDispatch: vi.fn(),
    mockClaim: vi.fn(),
    mockWhere: vi.fn(),
  })
)

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/knowledge/connectors/directory-queue', () => ({
  dispatchDirectorySync: mockDispatch,
}))
vi.mock('@sim/db', () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ returning: () => mockClaim() }) }) }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (condition: unknown) => {
            mockWhere(condition)
            return { orderBy: () => ({ limit: () => mockConnectorRows() }) }
          },
        }),
      }),
    }),
  },
}))

import { GET } from '@/app/api/knowledge/connectors/directory-sync/route'

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
