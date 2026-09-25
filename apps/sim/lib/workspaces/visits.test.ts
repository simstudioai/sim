/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listRecentWorkspaceIds,
  recordWorkspaceVisitRecord,
  sortByVisitRecency,
} from '@/lib/workspaces/visits'

describe('workspace visits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('upserts the visit time for the user and workspace', async () => {
    await recordWorkspaceVisitRecord('user-1', 'ws-1')

    expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.workspaceVisit)
    const [[row]] = dbChainMockFns.values.mock.calls
    expect(row).toEqual({ userId: 'user-1', workspaceId: 'ws-1', visitedAt: expect.any(Date) })
    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith({
      target: [schemaMock.workspaceVisit.userId, schemaMock.workspaceVisit.workspaceId],
      set: { visitedAt: row.visitedAt },
    })
  })

  it('lists visited workspace ids in the order the query returns them', async () => {
    queueTableRows(schemaMock.workspaceVisit, [{ workspaceId: 'recent' }, { workspaceId: 'older' }])

    await expect(listRecentWorkspaceIds('user-1')).resolves.toEqual(['recent', 'older'])
  })

  it('orders visited workspaces first and keeps the rest in incoming order', () => {
    const workspaces = [{ id: 'n1' }, { id: 'v2' }, { id: 'n2' }, { id: 'v1' }]

    expect(sortByVisitRecency(workspaces, ['v1', 'gone', 'v2']).map(({ id }) => id)).toEqual([
      'v1',
      'v2',
      'n1',
      'n2',
    ])
    expect(sortByVisitRecency(workspaces, []).map(({ id }) => id)).toEqual(['n1', 'v2', 'n2', 'v1'])
  })
})
