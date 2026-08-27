/**
 * @vitest-environment node
 */
import { folder as folderTable } from '@sim/db/schema'
import {
  dbChainMockFns,
  type MockCondition,
  resetDbChainMock,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The `workspace_files` columns {@link fileRows} enforces its unique indexes on. */
interface WorkspaceFileRow {
  id: string
  key: string
  workspaceId: string | null
  folderId?: string | null
  context: string
  originalName: string
  deletedAt: Date | null
  [column: string]: unknown
}

/**
 * `fileRows` is the shared stand-in for the `workspace_files` table: the mocked name
 * allocator reads it exactly as the real one queries the DB, and the insert simulation in
 * `executeForkFileBlobCopies collisions` enforces the same unique indexes against it. One
 * store, so the allocator and the index can never disagree the way two fixtures would.
 */
const {
  fileRows,
  mockAllocateUniqueWorkspaceFileName,
  mockCopyWorkspaceFileSecretProvenanceInTx,
  mockIncrementStorageUsageInTx,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => {
  const fileRows: WorkspaceFileRow[] = []
  const withCopySuffix = (name: string, n: number) => {
    const lastDot = name.lastIndexOf('.')
    return lastDot > 0 && lastDot < name.length - 1
      ? `${name.slice(0, lastDot)} (${n})${name.slice(lastDot)}`
      : `${name} (${n})`
  }
  return {
    fileRows,
    /**
     * Mirrors `allocateUniqueWorkspaceFileName`: the taken-name probe matches the columns
     * of `workspace_files_workspace_folder_name_active_unique`.
     */
    mockAllocateUniqueWorkspaceFileName: vi.fn(
      async (workspaceId: string, baseName: string, folderId?: string | null) => {
        const taken = (name: string) =>
          fileRows.some(
            (row) =>
              row.deletedAt === null &&
              row.context === 'workspace' &&
              row.workspaceId === workspaceId &&
              (row.folderId ?? null) === (folderId ?? null) &&
              row.originalName === name
          )
        if (!taken(baseName)) return baseName
        for (let n = 1; n <= 1000; n++) {
          const candidate = withCopySuffix(baseName, n)
          if (!taken(candidate)) return candidate
        }
        throw new Error(`A file named "${baseName}" already exists in this workspace`)
      }
    ),
    mockCopyWorkspaceFileSecretProvenanceInTx: vi.fn(),
    mockIncrementStorageUsageInTx: vi.fn(),
    mockResolveStorageBillingContext: vi.fn(),
  }
})

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/billing/storage', () => ({
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageInTx,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  allocateUniqueWorkspaceFileName: mockAllocateUniqueWorkspaceFileName,
  generateWorkspaceFileKey: vi.fn(
    (workspaceId: string, fileName: string) => `workspace/${workspaceId}/generated-${fileName}`
  ),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  copyWorkspaceFileSecretProvenanceInTx: mockCopyWorkspaceFileSecretProvenanceInTx,
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  type BlobCopyTask,
  executeForkFileBlobCopies,
  planForkFileCopies,
} from '@/ee/workspace-forking/lib/copy/copy-files'

function makeTask(overrides: Partial<BlobCopyTask> = {}): BlobCopyTask {
  return {
    sourceFileId: 'source-file-1',
    sourceContentUpdatedAtMs: new Date('2026-01-01T00:00:00.000Z').getTime(),
    sourceKey: 'workspace/src-ws/source-a.txt',
    targetKey: 'workspace/child-ws/target-a.txt',
    context: 'workspace',
    fileName: 'a.txt',
    contentType: 'text/plain',
    size: 100,
    targetFileId: 'target-file-1',
    displayName: null,
    userId: 'user-1',
    workspaceId: 'child-ws',
    ...overrides,
  }
}

describe('executeForkFileBlobCopies storage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    fileRows.length = 0
    storageServiceMockFns.mockHeadObject.mockResolvedValue(null)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({ key: 'workspace/child-ws/target' })
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'child-ws',
      billedAccountUserId: 'target-payer',
      billingEntity: { type: 'user', id: 'target-payer' },
      plan: 'pro',
      customStorageLimitGB: null,
    })
    mockIncrementStorageUsageInTx.mockResolvedValue(100)
  })

  it('copies first, then atomically inserts metadata and charges the target payer exactly once on replay', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'target-file-1' }])
    dbChainMockFns.where.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'target-file-1',
        key: 'workspace/child-ws/target-a.txt',
        workspaceId: 'child-ws',
      },
    ])

    const first = await executeForkFileBlobCopies([makeTask()], 'test')
    const replay = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(first).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(replay).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ persistMetadata: false })
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('child-ws')
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'child-ws',
        billedAccountUserId: 'target-payer',
      }),
      100
    )
    expect(storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
  })

  it('bulk-checks finalized metadata once per bounded task page', async () => {
    const tasks = Array.from({ length: 501 }, (_, index) =>
      makeTask({
        sourceKey: `workspace/src-ws/source-${index}.txt`,
        targetKey: `workspace/child-ws/target-${index}.txt`,
        targetFileId: `target-file-${index}`,
      })
    )
    const finalizedRows = tasks.map((task) => ({
      id: task.targetFileId,
      key: task.targetKey,
      workspaceId: task.workspaceId,
    }))
    dbChainMockFns.where
      .mockResolvedValueOnce(finalizedRows.slice(0, 500))
      .mockResolvedValueOnce(finalizedRows.slice(500))

    const result = await executeForkFileBlobCopies(tasks, 'test')

    expect(result).toEqual({ copied: 501, failed: 0, failedTargetKeys: [] })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('rejects bulk replay metadata whose deterministic key or workspace does not match', async () => {
    const exact = makeTask()
    const conflict = makeTask({
      targetFileId: 'target-file-2',
      targetKey: 'workspace/child-ws/target-b.txt',
    })
    dbChainMockFns.where.mockResolvedValueOnce([
      { id: exact.targetFileId, key: exact.targetKey, workspaceId: exact.workspaceId },
      { id: conflict.targetFileId, key: conflict.targetKey, workspaceId: 'other-workspace' },
    ])

    const result = await executeForkFileBlobCopies([exact, conflict], 'test')

    expect(result).toEqual({
      copied: 1,
      failed: 1,
      failedTargetKeys: [conflict.targetKey],
    })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('leaves no active metadata and never charges when the blob copy fails', async () => {
    storageServiceMockFns.mockDownloadFile.mockRejectedValue(new Error('source gone'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['workspace/child-ws/target-a.txt'],
    })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
  })

  it('rolls back metadata and cleans up the blob when authoritative accounting fails', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'target-file-1' }])
    mockIncrementStorageUsageInTx.mockRejectedValueOnce(new Error('quota changed'))

    const result = await executeForkFileBlobCopies([makeTask()], 'test')

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failedTargetKeys: ['workspace/child-ws/target-a.txt'],
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledWith({
      key: 'workspace/child-ws/target-a.txt',
      context: 'workspace',
    })
  })
})

/** Rejects a predicate the harness does not model, rather than letting it match everything. */
function unsupportedPredicate(detail: string): never {
  throw new Error(`Unsupported predicate in test harness: ${detail}`)
}

/** The nested clauses of an `and`/`or` node, or a throw when the node carries none. */
function predicateClauses(node: MockCondition): unknown[] {
  if (!Array.isArray(node.conditions))
    unsupportedPredicate(`${String(node.type)} without conditions`)
  return node.conditions
}

/**
 * The row key a predicate node references. The mocked schema tables are column-name maps, so a
 * column reference is the column name itself; anything else is a shape this harness cannot read.
 */
function predicateColumn(node: MockCondition, field: 'left' | 'column'): string {
  const column = node[field]
  if (typeof column !== 'string')
    unsupportedPredicate(`${String(node.type)} with a non-column ${field}`)
  // Schema-mock columns are `table.column`; row fixtures are keyed by field name.
  return column.slice(column.indexOf('.') + 1)
}

/**
 * Evaluate a mocked drizzle predicate against a row. Real predicate reading, so a chain that
 * ignores its `where` clause cannot pass these tests by echoing a fixture back.
 */
function matchesPredicate(row: Record<string, unknown>, predicate: unknown): boolean {
  if (!predicate) return true
  if (typeof predicate !== 'object') unsupportedPredicate(typeof predicate)
  const node = predicate as MockCondition
  switch (node.type) {
    case 'and':
      return predicateClauses(node).every((clause) => matchesPredicate(row, clause))
    case 'or':
      return predicateClauses(node).some((clause) => matchesPredicate(row, clause))
    case 'eq':
      return row[predicateColumn(node, 'left')] === node.right
    case 'isNull': {
      const value = row[predicateColumn(node, 'column')]
      return value === null || value === undefined
    }
    case 'inArray': {
      if (!Array.isArray(node.values)) unsupportedPredicate('inArray without values')
      return node.values.includes(row[predicateColumn(node, 'column')])
    }
    default:
      return unsupportedPredicate(String(node.type))
  }
}

/** Awaitable stand-in for a drizzle select result, supporting `.limit`/`.for`/`.orderBy`. */
interface MockSelectResult extends PromiseLike<WorkspaceFileRow[]> {
  catch: Promise<WorkspaceFileRow[]>['catch']
  finally: Promise<WorkspaceFileRow[]>['finally']
  limit: (count: number) => MockSelectResult
  for: () => MockSelectResult
  orderBy: () => MockSelectResult
}

function selectResult(rows: WorkspaceFileRow[]): MockSelectResult {
  const settled = Promise.resolve(rows)
  const builder: MockSelectResult = {
    then: (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected),
    catch: (onRejected) => settled.catch(onRejected),
    finally: (onFinally) => settled.finally(onFinally),
    limit: (count: number) => selectResult(rows.slice(0, count)),
    for: () => builder,
    orderBy: () => builder,
  }
  return builder
}

/**
 * Postgres-faithful `workspace_files` writes against {@link fileRows}: `key` is guarded by
 * `workspace_files_key_active_unique` and `(workspace_id, coalesce(folder_id, ''),
 * original_name)` by `workspace_files_workspace_folder_name_active_unique`. A bare
 * `onConflictDoNothing()` absorbs BOTH plus the primary key (the shipped bug); one targeted at
 * the primary key absorbs only a replay of the same row and lets a real name clash raise.
 */
function installFileTableSimulation(): void {
  dbChainMockFns.where.mockImplementation((predicate: unknown) =>
    selectResult(fileRows.filter((row) => matchesPredicate(row, predicate)))
  )
  dbChainMockFns.values.mockImplementation((row: WorkspaceFileRow) => {
    const attemptInsert = (conflictTarget: unknown) => {
      const pkConflict = fileRows.some((existing) => existing.id === row.id)
      const activeConflict = fileRows.some(
        (existing) =>
          existing.deletedAt === null &&
          (existing.key === row.key ||
            (existing.context === 'workspace' &&
              existing.workspaceId === row.workspaceId &&
              (existing.folderId ?? null) === (row.folderId ?? null) &&
              existing.originalName === row.originalName))
      )
      if (conflictTarget === undefined ? pkConflict || activeConflict : pkConflict) {
        return Promise.resolve([])
      }
      if (activeConflict) {
        return Promise.reject(
          Object.assign(
            new Error(
              'duplicate key value violates unique constraint ' +
                '"workspace_files_workspace_folder_name_active_unique"'
            ),
            { code: '23505' }
          )
        )
      }
      fileRows.push({ ...row })
      return Promise.resolve([{ id: row.id }])
    }
    return {
      onConflictDoNothing: (config?: { target?: unknown }) => {
        dbChainMockFns.onConflictDoNothing(config)
        return { returning: () => attemptInsert(config?.target) }
      },
      onConflictDoUpdate: () => ({ returning: () => attemptInsert(undefined) }),
      returning: () => attemptInsert('no-conflict-clause'),
    }
  })
}

describe('executeForkFileBlobCopies target name collisions', () => {
  const collidingTask = () =>
    makeTask({
      fileName: 'budget.xlsx',
      sourceKey: 'workspace/src-ws/source-budget.xlsx',
      targetKey: 'workspace/child-ws/target-budget.xlsx',
      contentType: 'application/vnd.ms-excel',
      targetFolderId: 'target-reports',
      displayName: 'budget.xlsx',
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    fileRows.length = 0
    storageServiceMockFns.mockHeadObject.mockResolvedValue(null)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      key: 'workspace/child-ws/target-budget.xlsx',
    })
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'child-ws',
      billedAccountUserId: 'target-payer',
      billingEntity: { type: 'user', id: 'target-payer' },
      plan: 'pro',
      customStorageLimitGB: null,
    })
    mockIncrementStorageUsageInTx.mockResolvedValue(100)
    installFileTableSimulation()
  })

  it('keeps a file whose name is already taken in the reused target folder', async () => {
    // The target already holds `Reports/budget.xlsx`; the fork mirrors `Reports` onto it.
    fileRows.push({
      id: 'pre-existing',
      key: 'workspace/child-ws/pre-existing-budget.xlsx',
      workspaceId: 'child-ws',
      folderId: 'target-reports',
      context: 'workspace',
      originalName: 'budget.xlsx',
      deletedAt: null,
    })

    const result = await executeForkFileBlobCopies([collidingTask()], 'test')

    expect(result).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    // Non-destructive: the copy lands beside the target's own file, in the mirrored folder.
    expect(fileRows).toHaveLength(2)
    expect(fileRows.find((row) => row.id === 'pre-existing')?.originalName).toBe('budget.xlsx')
    expect(fileRows.find((row) => row.id === 'target-file-1')).toMatchObject({
      key: 'workspace/child-ws/target-budget.xlsx',
      workspaceId: 'child-ws',
      folderId: 'target-reports',
      originalName: 'budget (1).xlsx',
      displayName: 'budget (1).xlsx',
      deletedAt: null,
    })
    // The blob backing the surviving row must never be swept.
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
    // The de-duplication probe is scoped to the index's exact tuple, folder included.
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledWith(
      'child-ws',
      'budget.xlsx',
      'target-reports'
    )
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
  })

  it('absorbs only a primary-key conflict, so a name conflict can never be mistaken for a replay', async () => {
    await executeForkFileBlobCopies([collidingTask()], 'test')

    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({ target: 'workspaceFiles.id' })
  })

  it('copies a non-colliding file into the mirrored folder unchanged', async () => {
    fileRows.push({
      id: 'pre-existing',
      key: 'workspace/child-ws/pre-existing-forecast.xlsx',
      workspaceId: 'child-ws',
      folderId: 'target-reports',
      context: 'workspace',
      originalName: 'forecast.xlsx',
      deletedAt: null,
    })

    const result = await executeForkFileBlobCopies([collidingTask()], 'test')

    expect(result).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(fileRows.find((row) => row.id === 'target-file-1')).toMatchObject({
      folderId: 'target-reports',
      originalName: 'budget.xlsx',
      displayName: 'budget.xlsx',
    })
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })

  it('de-duplicates each same-named copy against the rows earlier tasks already landed', async () => {
    // Two source files share a name inside the folder the target already has a `budget.xlsx` in.
    // Each allocation must see the row the previous task committed, so the suffixes advance
    // instead of every task racing for the same `budget (1).xlsx`.
    fileRows.push({
      id: 'pre-existing',
      key: 'workspace/child-ws/pre-existing-budget.xlsx',
      workspaceId: 'child-ws',
      folderId: 'target-reports',
      context: 'workspace',
      originalName: 'budget.xlsx',
      deletedAt: null,
    })

    const result = await executeForkFileBlobCopies(
      [
        collidingTask(),
        makeTask({
          fileName: 'budget.xlsx',
          sourceKey: 'workspace/src-ws/source-budget-2.xlsx',
          targetKey: 'workspace/child-ws/target-budget-2.xlsx',
          contentType: 'application/vnd.ms-excel',
          targetFolderId: 'target-reports',
          targetFileId: 'target-file-2',
        }),
      ],
      'test'
    )

    expect(result).toEqual({ copied: 2, failed: 0, failedTargetKeys: [] })
    expect(fileRows.map((row) => row.originalName)).toEqual([
      'budget.xlsx',
      'budget (1).xlsx',
      'budget (2).xlsx',
    ])
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })

  it('replays to the same end state without duplicating the copy or failing differently', async () => {
    fileRows.push({
      id: 'pre-existing',
      key: 'workspace/child-ws/pre-existing-budget.xlsx',
      workspaceId: 'child-ws',
      folderId: 'target-reports',
      context: 'workspace',
      originalName: 'budget.xlsx',
      deletedAt: null,
    })

    const first = await executeForkFileBlobCopies([collidingTask()], 'test')
    const afterFirst = structuredClone(fileRows)
    const replay = await executeForkFileBlobCopies([collidingTask()], 'test')

    expect(first).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    // The replay resolves the existing copy instead of re-copying: still one success, no failure.
    expect(replay).toEqual({ copied: 1, failed: 0, failedTargetKeys: [] })
    expect(fileRows).toEqual(afterFirst)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })
})

describe('planForkFileCopies', () => {
  it('plans deterministic target metadata without inserting an active row before blob copy', async () => {
    const sourceMeta = {
      id: 'wf_src1',
      key: 'workspace/src-ws/1-abc-a.txt',
      userId: 'uploader-1',
      workspaceId: 'src-ws',
      folderId: 'folder-1',
      context: 'workspace',
      chatId: null,
      originalName: 'a.txt',
      displayName: null,
      contentType: 'text/plain',
      size: 4321,
      sizeBytes: 4321,
      deletedAt: null,
      uploadedAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      contentUpdatedAt: new Date('2026-01-01'),
    }
    const tx = {
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([sourceMeta]) }) })),
      insert: vi.fn(),
    } as unknown as DbOrTx

    const result = await planForkFileCopies({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      fileIds: ['wf_src1'],
      now: new Date('2026-02-01'),
    })

    expect(result.blobTasks).toHaveLength(1)
    expect(result.blobTasks[0]).toMatchObject({
      sourceKey: 'workspace/src-ws/1-abc-a.txt',
      targetKey: 'workspace/child-ws/generated-a.txt',
      size: 4321,
      targetFileId: expect.any(String),
      userId: 'user-1',
      workspaceId: 'child-ws',
    })
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('mirrors the source file-folder subtree and places each copy inside it', async () => {
    const sourceMeta = {
      id: 'wf_src1',
      key: 'workspace/src-ws/1-abc-a.txt',
      userId: 'uploader-1',
      workspaceId: 'src-ws',
      folderId: 'child-folder',
      context: 'workspace',
      chatId: null,
      originalName: 'a.txt',
      displayName: null,
      contentType: 'text/plain',
      size: 4321,
      sizeBytes: 4321,
      deletedAt: null,
      uploadedAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      contentUpdatedAt: new Date('2026-01-01'),
    }
    // A two-level source tree; only the branch holding the copied file is mirrored.
    const sourceFolders = [
      {
        id: 'root-folder',
        name: 'Reports',
        parentId: null,
        workspaceId: 'src-ws',
        resourceType: 'file',
        deletedAt: null,
      },
      {
        id: 'child-folder',
        name: 'Q1',
        parentId: 'root-folder',
        workspaceId: 'src-ws',
        resourceType: 'file',
        deletedAt: null,
      },
      {
        id: 'unrelated',
        name: 'Archive',
        parentId: null,
        workspaceId: 'src-ws',
        resourceType: 'file',
        deletedAt: null,
      },
    ]
    const insertedFolders: Array<Record<string, unknown>> = []
    let folderSelectCall = 0
    const tx = {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => {
            if (table !== folderTable) return Promise.resolve([sourceMeta])
            // First folder read is the source tree; the second is the (empty) target tree.
            return Promise.resolve(folderSelectCall++ === 0 ? sourceFolders : [])
          },
        }),
      })),
      insert: vi.fn(() => ({
        values: (rows: Array<Record<string, unknown>>) => {
          insertedFolders.push(...rows)
          return Promise.resolve()
        },
      })),
    } as unknown as DbOrTx

    const result = await planForkFileCopies({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      fileIds: ['wf_src1'],
      now: new Date('2026-02-01'),
    })

    // The file's folder and its ancestor are recreated; the unrelated branch is pruned.
    expect(insertedFolders).toHaveLength(2)
    const byName = new Map(insertedFolders.map((row) => [row.name, row]))
    expect(byName.has('Archive')).toBe(false)
    const newRoot = byName.get('Reports')!
    const newChild = byName.get('Q1')!
    expect(newRoot).toMatchObject({ parentId: null, workspaceId: 'child-ws' })
    // Nesting survives: the copied child points at the copied parent, not the source's.
    expect(newChild.parentId).toBe(newRoot.id)
    expect(newChild.id).not.toBe('child-folder')

    // The copied file lands in the mirrored folder rather than the target root.
    expect(result.blobTasks[0].targetFolderId).toBe(newChild.id)
    expect(result.folderIdMap.get('child-folder')).toBe(newChild.id)
    expect(result.folderIdMap.get('root-folder')).toBe(newRoot.id)
  })
})
