/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBatchDelete, mockDeleteRowsById, mockPrepareChatCleanup, mockExecuteChatCleanup } =
  vi.hoisted(() => ({
    mockBatchDelete: vi.fn(async (_options: unknown) => ({ deleted: 0, failed: 0 })),
    mockDeleteRowsById: vi.fn(async (..._args: unknown[]) => ({ deleted: 0, failed: 0 })),
    mockPrepareChatCleanup: vi.fn(),
    mockExecuteChatCleanup: vi.fn(async () => undefined),
  }))

vi.mock('@/lib/cleanup/batch-delete', () => ({
  batchDeleteByWorkspaceAndTimestamp: mockBatchDelete,
  deleteRowsById: mockDeleteRowsById,
  DEFAULT_DELETE_CHUNK_SIZE: 1000,
  selectRowsByIdChunks: async (
    ids: string[],
    query: (ids: string[], limit: number) => Promise<unknown[]>
  ) => (ids.length ? query(ids, 500) : []),
}))
vi.mock('@/lib/cleanup/chat-cleanup', () => ({ prepareChatCleanup: mockPrepareChatCleanup }))

import { runCleanupTasks } from '@/background/cleanup-tasks'

const organizationPayload = {
  plan: 'enterprise' as const,
  label: 'enterprise/organization/org-1',
  workspaceIds: [],
  organizationIds: ['org-1'],
  retentionHours: 48,
}

describe('chat retention ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))
    mockPrepareChatCleanup.mockResolvedValue({ execute: mockExecuteChatCleanup })
  })
  afterEach(() => {
    vi.useRealTimers()
    resetDbChainMock()
  })

  it('purges organization chats with exact owner and cutoff checks, without workspace tasks', async () => {
    queueTableRows(schemaMock.copilotChats, [{ id: 'org-chat' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'org-chat' }])
    await runCleanupTasks(organizationPayload)

    expect(mockPrepareChatCleanup).toHaveBeenCalledWith(['org-chat'], organizationPayload.label)
    expect(mockBatchDelete).not.toHaveBeenCalled()
    expect(mockDeleteRowsById).not.toHaveBeenCalled()
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.from).toHaveBeenCalledWith(schemaMock.copilotChats)
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.copilotChats)
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    for (const [predicate] of dbChainMockFns.where.mock.calls) {
      expect(
        hasMockCondition(
          predicate,
          (item) =>
            item.type === 'inArray' &&
            item.column === schemaMock.copilotChats.organizationId &&
            item.values.length === 1 &&
            item.values[0] === 'org-1'
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          predicate,
          (item) => item.type === 'isNull' && item.column === schemaMock.copilotChats.workspaceId
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          predicate,
          (item) =>
            item.type === 'lt' &&
            item.left === schemaMock.copilotChats.updatedAt &&
            item.right instanceof Date &&
            item.right.toISOString() === '2026-09-05T12:00:00.000Z'
        )
      ).toBe(true)
    }
    expect(mockExecuteChatCleanup).toHaveBeenCalledOnce()
    expect(mockPrepareChatCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
    expect(mockExecuteChatCleanup.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbChainMockFns.delete.mock.invocationCallOrder[0]
    )
  })

  it('keeps workspace run and inbox retention on the workspace path', async () => {
    queueTableRows(schemaMock.copilotChats, [{ id: 'workspace-chat' }])
    queueTableRows(schemaMock.copilotRuns, [])
    await runCleanupTasks({ ...organizationPayload, organizationIds: [], workspaceIds: ['ws-1'] })
    expect(mockBatchDelete).toHaveBeenCalledTimes(2)
    expect(mockBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        tableDef: schemaMock.copilotRuns,
        workspaceIds: ['ws-1'],
      })
    )
    expect(mockBatchDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        tableDef: schemaMock.mothershipInboxTask,
        workspaceIds: ['ws-1'],
      })
    )
    const [predicate] = dbChainMockFns.where.mock.calls[0]
    expect(
      hasMockCondition(
        predicate,
        (item) =>
          item.type === 'inArray' &&
          item.column === schemaMock.copilotChats.workspaceId &&
          item.values[0] === 'ws-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        predicate,
        (item) => item.type === 'isNull' && item.column === schemaMock.copilotChats.organizationId
      )
    ).toBe(true)
  })

  it('rejects mixed ownership before selecting or deleting any resource', async () => {
    await expect(
      runCleanupTasks({ ...organizationPayload, workspaceIds: ['ws-1'] })
    ).rejects.toThrow('Cleanup batches must name workspace or organization owners, not both')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mockPrepareChatCleanup).not.toHaveBeenCalled()
  })

  it('does no work for an empty owner batch', async () => {
    await runCleanupTasks({ ...organizationPayload, organizationIds: [] })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mockPrepareChatCleanup).not.toHaveBeenCalled()
  })
})
