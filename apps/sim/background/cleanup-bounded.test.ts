import {
  dbChainMock,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage, prepareChat, executeChat, hardDelete, billing, decrement, reRoot } = vi.hoisted(
  () => ({
    storage: vi.fn(),
    prepareChat: vi.fn(),
    executeChat: vi.fn(),
    hardDelete: vi.fn(),
    billing: vi.fn(),
    decrement: vi.fn(),
    reRoot: vi.fn(),
  })
)
vi.mock('@/background/cleanup-logs', () => ({ legacyLargeValuePredicate: vi.fn() }))
vi.mock('@/background/cleanup-soft-deletes', () => ({
  reRootActiveFolderChildrenUnguarded: reRoot,
}))
vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: () => true,
  StorageService: { deleteFiles: storage },
}))
vi.mock('@/lib/cleanup/chat-cleanup', () => ({ prepareChatCleanup: prepareChat }))
vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: hardDelete }))
vi.mock('@/lib/billing/storage', () => ({
  resolveStorageBillingContext: billing,
  decrementStorageUsageForBillingContextInTx: decrement,
}))

import { BoundedCleanup, type CleanupTransaction } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'
import { runBoundedLogScope } from '@/background/cleanup-logs-bounded'
import { runBoundedSoftDeleteScope } from '@/background/cleanup-soft-deletes-bounded'

const scope = {
  plan: 'free' as const,
  workspaceIds: ['ws-one'],
  retentionHours: 720,
  label: 'test',
  runGlobalHousekeeping: true,
}
function control(type: CleanupType, dryRun = true, limit = 1) {
  return new BoundedCleanup(
    { limits: { [type]: limit }, batchSize: 1, dryRun, requestId: 'test' },
    async () => {},
    Date.now,
    async (query) => query(dbChainMock.db as CleanupTransaction)
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  storage.mockResolvedValue({ deleted: 1, failed: [] })
  prepareChat.mockResolvedValue({ execute: executeChat })
})

describe('requested cleanup stages', () => {
  const targets = [
    ['workflowLogs', schemaMock.workflowExecutionLogs],
    ['jobLogs', schemaMock.jobExecutionLogs],
    ['largeValues', schemaMock.executionLargeValues],
    ['legacyLargeValues', schemaMock.workspaceFiles],
    ['orphanSnapshots', schemaMock.workflowExecutionSnapshots],
    ['workflows', schemaMock.workflow],
    ['chats', schemaMock.copilotChats],
    ['legacyFiles', schemaMock.workspaceFile],
    ['files', schemaMock.workspaceFiles],
    ['knowledgeBases', schemaMock.knowledgeBase],
    ['folders', schemaMock.folder],
    ['userTables', schemaMock.userTableDefinitions],
    ['memories', schemaMock.memory],
    ['mcpServers', schemaMock.mcpServers],
    ['workflowMcpServers', schemaMock.workflowMcpServer],
    ['orphanKnowledgeBaseBindings', schemaMock.workspaceFiles],
  ] as const
  it.each(targets)(
    'dry run of %s selects only that stage and has no side effects',
    async (type, table) => {
      queueTableRows(table, [{ id: 'root-one', key: 'key-one', files: [{ key: 'attached-file' }] }])
      const run = control(type)
      const runner =
        targets.findIndex(([candidate]) => candidate === type) < 5
          ? runBoundedLogScope
          : runBoundedSoftDeleteScope
      await runner(scope, run)
      expect(run.progress.stages[type]?.selected).toBe(1)
      expect(Object.keys(run.progress.stages)).toEqual([type])
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      for (const effect of [storage, prepareChat, hardDelete, billing, decrement, reRoot])
        expect(effect).not.toHaveBeenCalled()
    }
  )
  it.each(['staleReferences', 'staleDependencies', 'largeValueTombstones'] as const)(
    'dry run of %s uses SELECT only',
    async (type) => {
      dbChainMockFns.execute.mockResolvedValueOnce([{ id: 'metadata-one' }])
      const run = control(type)
      await runBoundedLogScope(scope, run)
      expect(run.progress.stages[type]?.selected).toBe(1)
      expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.execute.mock.calls[0][0].strings.join('')).toMatch(/^SELECT /)
    }
  )
  it('keeps the same log budget across workspace chunks', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `ws-${index}`)
    queueTableRows(schemaMock.jobExecutionLogs, [{ id: 'one' }])
    queueTableRows(schemaMock.jobExecutionLogs, [])
    queueTableRows(schemaMock.jobExecutionLogs, [{ id: 'two' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'deleted' }])
    const run = control('jobLogs', false, 2)
    await runBoundedLogScope({ ...scope, workspaceIds: ids }, run)
    expect(run.progress.stages.jobLogs).toMatchObject({ selected: 2, deleted: 2 })
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
  })
  it('records committed log deletion if attached storage cleanup fails', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ id: 'one', files: [{ key: 'blob' }] }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'one', files: [{ key: 'blob' }] }])
    storage.mockResolvedValue({ deleted: 0, failed: [{ key: 'blob', error: 'unavailable' }] })
    const run = control('workflowLogs', false)
    await expect(runBoundedLogScope(scope, run)).rejects.toThrow('storage deletions failed')
    expect(dbChainMockFns.delete).toHaveBeenCalledOnce()
    expect(run.progress.stages.workflowLogs).toMatchObject({
      selected: 1,
      deleted: 1,
      filesFailed: 1,
    })
  })
  it('does not remove files of a log protected after selection', async () => {
    queueTableRows(schemaMock.workflowExecutionLogs, [{ id: 'one', files: [{ key: 'blob' }] }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const run = control('workflowLogs', false)
    await runBoundedLogScope(scope, run)
    expect(storage).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(run.progress.stages.workflowLogs).toMatchObject({ selected: 1, deleted: 0, skipped: 1 })
  })
  it.each(['largeValues', 'legacyLargeValues'] as const)(
    'does not remove a %s key that fails the final liveness claim',
    async (type) => {
      queueTableRows(
        type === 'largeValues' ? schemaMock.executionLargeValues : schemaMock.workspaceFiles,
        [{ key: 'referenced-key' }]
      )
      dbChainMockFns.returning.mockResolvedValueOnce([])
      const run = control(type, false)
      await runBoundedLogScope(scope, run)
      expect(storage).not.toHaveBeenCalled()
      expect(run.progress.stages[type]).toMatchObject({ selected: 1, deleted: 0, skipped: 1 })
    }
  )
  it.each(['files', 'legacyFiles'] as const)(
    'does not remove a restored %s object',
    async (type) => {
      queueTableRows(type === 'files' ? schemaMock.workspaceFiles : schemaMock.workspaceFile, [
        { id: 'one', key: 'blob', context: 'workspace', workspaceId: 'ws-one', sizeBytes: 100 },
      ])
      billing.mockResolvedValue({ workspaceId: 'ws-one' })
      dbChainMockFns.returning.mockResolvedValueOnce([])
      const run = control(type, false)
      await runBoundedSoftDeleteScope(scope, run)
      expect(storage).not.toHaveBeenCalled()
      expect(run.progress.stages[type]).toMatchObject({ selected: 1, deleted: 0, skipped: 1 })
    }
  )
  it('keeps workflow chat side effects even with a zero chat budget', async () => {
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-one' }])
    queueTableRows(schemaMock.copilotChats, [{ id: 'child-chat' }])
    queueTableRows(schemaMock.copilotChats, [])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'workflow-one' }])
    const run = control('workflows', false)
    await runBoundedSoftDeleteScope(scope, run)
    expect(prepareChat).toHaveBeenCalledWith(
      ['child-chat'],
      'test',
      expect.objectContaining({ type: 'workflows' })
    )
    expect(executeChat).toHaveBeenCalledTimes(1)
    expect(run.progress.stages.workflows?.deleted).toBe(1)
    expect(run.progress.stages.chats).toBeUndefined()
  })
  it('counts committed workflow deletion when backend cleanup subsequently fails', async () => {
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-one' }])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'workflow-one' }])
    executeChat.mockRejectedValueOnce(new Error('backend failure'))
    const run = control('workflows', false)
    await expect(runBoundedSoftDeleteScope(scope, run)).rejects.toThrow('backend failure')
    expect(run.progress.stages.workflows?.deleted).toBe(1)
  })
  it('applies the shared file budget across workspace and organization scopes', async () => {
    const run = control('files', true, 2)
    queueTableRows(schemaMock.workspaceFiles, [{ id: 'workspace-file' }])
    queueTableRows(schemaMock.workspaceFiles, [])
    await runBoundedSoftDeleteScope(scope, run)
    queueTableRows(schemaMock.workspaceFiles, [{ id: 'organization-file' }])
    await runBoundedSoftDeleteScope(
      { ...scope, workspaceIds: [], organizationIds: ['org-one'] },
      run
    )
    expect(run.progress.stages.files?.selected).toBe(2)
    expect(storage).not.toHaveBeenCalled()
  })
})

describe('bounded file billing', () => {
  it('rechecks the exact payer workspace and decrements only bytes actually deleted', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      { id: 'file-one', key: 'blob', context: 'workspace', workspaceId: 'ws-one', sizeBytes: 100 },
    ])
    billing.mockResolvedValue({ workspaceId: 'ws-one' })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'file-one', sizeBytes: 40 }])
    const run = control('files', false)
    await runBoundedSoftDeleteScope({ ...scope, workspaceIds: ['ws-one', 'ws-two'] }, run)
    expect(decrement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws-one' }),
      40
    )
    expect(
      dbChainMockFns.where.mock.calls.some(([predicate]) =>
        hasMockCondition(
          predicate,
          (condition) =>
            condition.type === 'eq' &&
            condition.left === schemaMock.workspaceFiles.workspaceId &&
            condition.right === 'ws-one'
        )
      )
    ).toBe(true)
    expect(run.progress.stages.files?.deleted).toBe(1)
  })
  it('validates canonical sizes before deleting any storage', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      { id: 'file-one', key: 'blob', context: 'workspace', workspaceId: 'ws-one', sizeBytes: null },
    ])
    await expect(runBoundedSoftDeleteScope(scope, control('files', false))).rejects.toThrow(
      'canonical size_bytes'
    )
    expect(storage).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
