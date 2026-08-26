/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAllocateUniqueWorkspaceFileName,
  mockAdmitCreateWorkspaceFile,
  mockCheckStorageQuotaForBillingContext,
  mockDecompress,
  mockFetchBuffer,
  mockFindFolder,
  mockFindUpload,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockGetWorkspaceFile,
  mockHasCloudStorage,
  mockHeadObject,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockReadWorkspaceFileMetadata,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockAllocateUniqueWorkspaceFileName: vi.fn(),
  mockAdmitCreateWorkspaceFile: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecompress: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockFindFolder: vi.fn(),
  mockFindUpload: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockHeadObject: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockReadWorkspaceFileMetadata: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  allocateUniqueWorkspaceFileName: mockAllocateUniqueWorkspaceFileName,
  fetchWorkspaceFileBuffer: mockFetchBuffer,
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: { execute: mockReadWorkspaceFileMetadata },
}))

vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: mockAdmitCreateWorkspaceFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mockGetBoundWorkspaceFileSecretProvenance,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  findWorkspaceFileFolderIdByPath: mockFindFolder,
}))

vi.mock('@/lib/uploads/archive', () => ({
  decompressArchiveBufferToWorkspaceFiles: mockDecompress,
  ArchiveError: class ArchiveError extends Error {
    reason: string
    entryName?: string
    constructor(reason: string, message: string, entryName?: string) {
      super(message)
      this.name = 'ArchiveError'
      this.reason = reason
      this.entryName = entryName
    }
  },
  MAX_ARCHIVE_BYTES: 100 * 1024 * 1024,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mockHasCloudStorage,
  headObject: mockHeadObject,
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext: mockMaybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  canonicalWorkspaceFilePath: vi.fn(
    ({ name }: { name: string }) => `files/${encodeURIComponent(name)}`
  ),
  encodeVfsPathSegments: (segments: string[]) =>
    segments.map((s) => encodeURIComponent(s)).join('/'),
}))

vi.mock('@/lib/workflows/operations/import-export', () => ({ parseWorkflowJson: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ saveWorkflowToNormalizedTables: vi.fn() }))
vi.mock('@/lib/workflows/utils', () => ({ deduplicateWorkflowName: vi.fn() }))
vi.mock('@/app/api/v1/admin/types', () => ({ extractWorkflowMetadata: vi.fn() }))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeMaterializeFile } from '@/lib/copilot/tools/handlers/materialize-file'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { extractWorkflowMetadata } from '@/app/api/v1/admin/types'

const fetchWorkspaceFileBufferMock = vi.mocked(fetchWorkspaceFileBuffer)
const parseWorkflowJsonMock = vi.mocked(parseWorkflowJson)
const saveWorkflowToNormalizedTablesMock = vi.mocked(saveWorkflowToNormalizedTables)
const deduplicateWorkflowNameMock = vi.mocked(deduplicateWorkflowName)
const extractWorkflowMetadataMock = vi.mocked(extractWorkflowMetadata)

const context = {
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  workflowId: 'wf-1',
  copilotToolExecution: true,
  toolCallId: 'materialize-file-test',
} as ExecutionContext

mockReadWorkspaceFileMetadata.mockImplementation(
  async ({ input }: { input: { fileId: string; assertedWorkspaceId?: string } }) => ({
    file: await mockGetWorkspaceFile(
      input.assertedWorkspaceId ?? context.workspaceId,
      input.fileId,
      {
        throwOnError: true,
      }
    ),
  })
)

const STORAGE_CONTEXT = {
  workspaceId: 'ws-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

const POSTGRES_INT4_MAX = 2_147_483_647
const OVERSIZED_BYTES = 3 * 1024 * 1024 * 1024

const mothershipRow = {
  id: 'file-1',
  key: 'mothership/file-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  folderId: null,
  context: 'mothership',
  chatId: 'chat-1',
  originalName: 'upload.txt',
  displayName: 'report.txt',
  contentType: 'text/plain',
  size: 100,
  deletedAt: null,
  uploadedAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

describe('executeMaterializeFile - workspace write gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each(['save', 'import', 'extract'])(
    'refuses %s without workspace write access and touches no upload',
    async (operation) => {
      const { ensureWorkspaceAccess } = await import('@/lib/copilot/tools/handlers/access')
      const denial = new Error('Write access required for this workspace')
      if (operation === 'import') {
        vi.mocked(ensureWorkspaceAccess).mockRejectedValueOnce(denial)
      } else {
        mockAdmitCreateWorkspaceFile.mockRejectedValueOnce(denial)
      }

      const result = await executeMaterializeFile({ fileNames: ['a.json'], operation }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Write access required')
      expect(mockFindUpload).not.toHaveBeenCalled()
    }
  )

  it('requires write, not merely read, access', async () => {
    await executeMaterializeFile({ fileNames: ['a.json'], operation: 'save' }, context)

    expect(mockAdmitCreateWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'delegated', subjectUserId: context.userId }),
      context.workspaceId
    )
  })
})

describe('executeMaterializeFile - unsupported operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('rejects the table operation and points to the table subagent', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'table' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported save_upload operation "table"')
    expect(result.error).toContain('table subagent')
    expect(mockFindUpload).not.toHaveBeenCalled()
  })

  it('rejects the manage_knowledge_base operation and points to the knowledge subagent', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'manage_knowledge_base' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported save_upload operation "manage_knowledge_base"')
    expect(result.error).toContain('knowledge subagent')
    expect(mockFindUpload).not.toHaveBeenCalled()
  })
})

describe('executeMaterializeFile - workflow import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFindUpload.mockResolvedValue({
      ...mothershipRow,
      originalName: 'workflow.json',
      displayName: 'workflow.json',
      contentType: 'application/json',
    })
    fetchWorkspaceFileBufferMock.mockResolvedValue(Buffer.from('{"metadata":{}}'))
    parseWorkflowJsonMock.mockReturnValue({
      data: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: [] },
      errors: [],
    })
    extractWorkflowMetadataMock.mockReturnValue({
      name: 'Imported Workflow',
      description: 'PRIVATE WORKFLOW DESCRIPTION',
    })
    deduplicateWorkflowNameMock.mockResolvedValue('Imported Workflow')
    saveWorkflowToNormalizedTablesMock.mockResolvedValue({ success: true })
  })

  it('does not persist the uploaded workflow description', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['workflow.json'], operation: 'import' },
      context
    )

    expect(result.success).toBe(true)
    const insertedWorkflow = dbChainMockFns.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertedWorkflow).toMatchObject({ name: 'Imported Workflow' })
    expect(insertedWorkflow).not.toHaveProperty('description')
    expect(JSON.stringify(dbChainMockFns.values.mock.calls)).not.toContain(
      'PRIVATE WORKFLOW DESCRIPTION'
    )
  })
})

describe('executeMaterializeFile - save storage transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockFindUpload.mockResolvedValue(mothershipRow)
    mockAllocateUniqueWorkspaceFileName.mockResolvedValue('report.txt')
    mockGetWorkspaceFile.mockResolvedValue({ id: 'file-1', name: 'report.txt' })
    mockHeadObject.mockResolvedValue({ size: 250, contentType: 'text/plain' })
    mockHasCloudStorage.mockReturnValue(true)
    mockResolveStorageBillingContext.mockResolvedValue(STORAGE_CONTEXT)
    mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
    mockIncrementStorageUsageForBillingContextInTx.mockResolvedValue(1_250)
    mockMaybeNotifyStorageLimitForBillingContext.mockResolvedValue(undefined)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'file-1', originalName: 'report.txt' }])
  })

  it('HEADs before the transaction and accounts the verified object size', async () => {
    let transactionOpen = false
    mockHeadObject.mockImplementationOnce(async () => {
      expect(transactionOpen).toBe(false)
      return { size: 250, contentType: 'text/plain' }
    })
    dbChainMockFns.transaction.mockImplementationOnce(
      async (callback: (tx: typeof dbChainMock.db) => unknown) => {
        transactionOpen = true
        try {
          return await callback(dbChainMock.db)
        } finally {
          transactionOpen = false
        }
      }
    )
    mockIncrementStorageUsageForBillingContextInTx.mockImplementationOnce(
      async (_tx, _billingContext, bytes) => {
        expect(transactionOpen).toBe(true)
        expect(bytes).toBe(250)
        return 1_250
      }
    )

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockHeadObject).toHaveBeenCalledWith('mothership/file-1', 'mothership')
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(STORAGE_CONTEXT, 250)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledWith(
      context.workspaceId,
      'report.txt',
      null
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'workspace', chatId: null, sizeBytes: 250 })
    )
    expect(mockMaybeNotifyStorageLimitForBillingContext).toHaveBeenCalledWith(
      STORAGE_CONTEXT,
      1_250
    )
  })

  it('writes the exact byte count above the int4 ceiling without the legacy projection', async () => {
    mockHeadObject.mockResolvedValue({ size: OVERSIZED_BYTES, contentType: 'text/plain' })

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    const [updateSet] = dbChainMockFns.set.mock.calls.at(-1) as [Record<string, unknown>]
    expect(updateSet).not.toHaveProperty('size')
    expect(updateSet.sizeBytes).toBe(OVERSIZED_BYTES)
    expect(mockCheckStorageQuotaForBillingContext).toHaveBeenCalledWith(
      STORAGE_CONTEXT,
      OVERSIZED_BYTES
    )
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.anything(),
      STORAGE_CONTEXT,
      OVERSIZED_BYTES
    )
  })

  it('uses the exact stored byte count when object metadata is unavailable', async () => {
    mockHeadObject.mockResolvedValue(null)
    mockHasCloudStorage.mockReturnValue(false)
    mockFindUpload.mockResolvedValue({
      ...mothershipRow,
      size: POSTGRES_INT4_MAX,
      sizeBytes: OVERSIZED_BYTES,
    })

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    const [updateSet] = dbChainMockFns.set.mock.calls.at(-1) as [Record<string, unknown>]
    expect(updateSet.sizeBytes).toBe(OVERSIZED_BYTES)
    expect(updateSet).not.toHaveProperty('size')
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.anything(),
      STORAGE_CONTEXT,
      OVERSIZED_BYTES
    )
  })

  it('materializes with an available root-level copy name', async () => {
    mockFindUpload.mockResolvedValueOnce({
      ...mothershipRow,
      originalName: 'image.png',
      displayName: 'image.png',
    })
    mockAllocateUniqueWorkspaceFileName.mockResolvedValueOnce('image (1).png')
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'file-1', originalName: 'image (1).png' },
    ])

    const result = await executeMaterializeFile(
      { fileNames: ['image.png'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledWith(
      context.workspaceId,
      'image.png',
      null
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'workspace',
        originalName: 'image (1).png',
        displayName: 'image (1).png',
      })
    )
    expect(result.output).toEqual({ succeeded: ['image (1).png'], failed: [] })
    expect(result.resources).toEqual([{ type: 'file', id: 'file-1', title: 'image (1).png' }])
  })

  it('reallocates and retries when a concurrent root-level write claims the name', async () => {
    const nameCollision = Object.assign(new Error('duplicate workspace file name'), {
      code: '23505',
      constraint_name: 'workspace_files_workspace_folder_name_active_unique',
    })
    mockFindUpload.mockResolvedValueOnce({
      ...mothershipRow,
      originalName: 'image.png',
      displayName: 'image.png',
    })
    mockAllocateUniqueWorkspaceFileName
      .mockResolvedValueOnce('image (1).png')
      .mockResolvedValueOnce('image (2).png')
    dbChainMockFns.returning
      .mockRejectedValueOnce(nameCollision)
      .mockResolvedValueOnce([{ id: 'file-1', originalName: 'image (2).png' }])

    const result = await executeMaterializeFile(
      { fileNames: ['image.png'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledTimes(2)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenNthCalledWith(
      1,
      context.workspaceId,
      'image.png',
      null
    )
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenNthCalledWith(
      2,
      context.workspaceId,
      'image.png',
      null
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ originalName: 'image (1).png' })
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ originalName: 'image (2).png' })
    )
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({ succeeded: ['image (2).png'], failed: [] })
    expect(result.resources).toEqual([{ type: 'file', id: 'file-1', title: 'image (2).png' }])
  })

  it('stops after the bounded number of root-level name collisions', async () => {
    const nameCollision = Object.assign(new Error('duplicate workspace file name'), {
      code: '23505',
      constraint_name: 'workspace_files_workspace_folder_name_active_unique',
    })
    dbChainMockFns.returning.mockRejectedValue(nameCollision)

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledTimes(8)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(8)
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('does not retry unique violations from a different constraint', async () => {
    const keyCollision = Object.assign(new Error('duplicate workspace file key'), {
      code: '23505',
      constraint_name: 'workspace_files_key_active_unique',
    })
    dbChainMockFns.returning.mockRejectedValueOnce(keyCollision)

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(mockAllocateUniqueWorkspaceFileName).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })

  it('treats a lost conditional transition as a replay no-op', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    mockGetWorkspaceFile.mockResolvedValueOnce({ id: 'file-1', name: 'report (1).txt' })

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith(context.workspaceId, 'file-1', {
      throwOnError: true,
    })
    expect(result.output).toEqual({ succeeded: ['report (1).txt'], failed: [] })
    expect(result.resources).toEqual([{ type: 'file', id: 'file-1', title: 'report (1).txt' }])
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('fails a replay when the materialized workspace file no longer exists', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    mockGetWorkspaceFile.mockResolvedValueOnce(null)

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.output).toEqual({
      succeeded: [],
      failed: [
        {
          fileName: 'report.txt',
          error: 'Upload no longer available: "report.txt".',
        },
      ],
    })
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith(context.workspaceId, 'file-1', {
      throwOnError: true,
    })
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('leaves the mothership row untouched when pre-admission rejects quota', async () => {
    mockCheckStorageQuotaForBillingContext.mockResolvedValueOnce({
      allowed: false,
      error: 'Storage limit exceeded',
    })

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageForBillingContextInTx).not.toHaveBeenCalled()
  })

  it('fails atomically when the in-transaction quota recheck rejects', async () => {
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('Storage limit exceeded')
    )

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageForBillingContextInTx).toHaveBeenCalledWith(
      expect.anything(),
      STORAGE_CONTEXT,
      250
    )
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })

  it('fails on a stale payer instead of charging a new payer', async () => {
    mockIncrementStorageUsageForBillingContextInTx.mockRejectedValueOnce(
      new Error('Storage payer changed for workspace ws-1')
    )

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('report.txt')
    expect(mockMaybeNotifyStorageLimitForBillingContext).not.toHaveBeenCalled()
  })
})

describe('executeMaterializeFile - extract operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFolder.mockResolvedValue(null)
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({
      status: 'exact',
      entries: [],
    })
  })

  function zipRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'wf_zip',
      key: 'mothership/abc/bundle.zip',
      userId: 'user-1',
      workspaceId: 'ws-1',
      context: 'mothership',
      chatId: 'chat-1',
      originalName: 'bundle.zip',
      displayName: 'bundle.zip',
      contentType: 'application/zip',
      size: 2048,
      deletedAt: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }

  it('dispatches to the archive extractor and returns the unpacked files', async () => {
    mockFindUpload.mockResolvedValue(zipRow())
    mockFetchBuffer.mockResolvedValue(Buffer.from('zip-bytes'))
    mockDecompress.mockResolvedValue({
      extracted: [
        { id: 'f1', name: 'a.txt', url: '/x', size: 1, type: 'text/plain', key: 'k1' },
        { id: 'f2', name: 'b.txt', url: '/y', size: 2, type: 'text/plain', key: 'k2' },
      ],
      skipped: 0,
      skippedUnsafePaths: [],
    })

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockDecompress).toHaveBeenCalledTimes(1)
    expect(mockDecompress).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        workspaceId: 'ws-1',
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'user-1',
          workspaceId: 'ws-1',
        }),
        rootFolderSegments: ['bundle'],
        skipNoiseEntries: true,
        secretProvenance: { status: 'exact', entries: [] },
      })
    )
    expect(result.output).toMatchObject({ succeeded: ['bundle.zip'], failed: [] })
    expect(result.resources).toEqual([
      { type: 'file', id: 'f1', title: 'a.txt' },
      { type: 'file', id: 'f2', title: 'b.txt' },
    ])
  })

  it('refuses to extract an upload that belongs to a different workspace', async () => {
    mockFindUpload.mockResolvedValue(zipRow({ workspaceId: 'other-ws' }))

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(false)
    const output = result.output as { failed: Array<{ fileName: string; error: string }> }
    expect(output.failed[0].error).toContain('does not belong to this workspace')
    expect(mockDecompress).not.toHaveBeenCalled()
  })

  it('reports an already-extracted archive instead of duplicating the tree', async () => {
    mockFindUpload.mockResolvedValue(zipRow())
    mockFindFolder.mockResolvedValue('folder-existing')
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'f-old' }])

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(false)
    const output = result.output as { failed: Array<{ fileName: string; error: string }> }
    expect(output.failed[0].error).toContain('already extracted')
    expect(mockDecompress).not.toHaveBeenCalled()
  })

  it('detects a prior nested-only extraction via subfolders, not just direct files', async () => {
    // A zip containing only nested entries (src/index.ts) leaves NO direct files
    // under the archive root — only subfolders. The guard must still refuse.
    mockFindUpload.mockResolvedValue(zipRow())
    mockFindFolder.mockResolvedValue('folder-existing')
    dbChainMockFns.limit.mockResolvedValueOnce([]) // no direct files
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'subfolder-1' }]) // but a subfolder tree

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(false)
    const output = result.output as { failed: Array<{ fileName: string; error: string }> }
    expect(output.failed[0].error).toContain('already extracted')
    expect(mockDecompress).not.toHaveBeenCalled()
  })

  it('dedupes repeated fileNames so one call cannot double-extract', async () => {
    mockFindUpload.mockResolvedValue(zipRow())
    mockFetchBuffer.mockResolvedValue(Buffer.from('zip-bytes'))
    mockDecompress.mockResolvedValue({
      extracted: [{ id: 'f1', name: 'a.txt', url: '/x', size: 1, type: 'text/plain', key: 'k1' }],
      skipped: 0,
      skippedUnsafePaths: [],
    })

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip', 'bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockDecompress).toHaveBeenCalledTimes(1)
  })

  it('folds degenerate archive names into the "archive" fallback folder', async () => {
    mockFindUpload.mockResolvedValue(zipRow({ displayName: '..zip', originalName: '..zip' }))
    mockFetchBuffer.mockResolvedValue(Buffer.from('zip-bytes'))
    mockDecompress.mockResolvedValue({
      extracted: [{ id: 'f1', name: 'a.txt', url: '/x', size: 1, type: 'text/plain', key: 'k1' }],
      skipped: 0,
      skippedUnsafePaths: [],
    })

    const result = await executeMaterializeFile(
      { fileNames: ['..zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockDecompress).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ rootFolderSegments: ['archive'] })
    )
  })
})

describe('executeMaterializeFile - save operation on archives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFolder.mockResolvedValue(null)
  })

  it('refuses to save a .zip upload and points at extract instead', async () => {
    mockFindUpload.mockResolvedValue({
      id: 'wf_zip',
      key: 'mothership/abc/bundle.zip',
      userId: 'user-1',
      workspaceId: 'ws-1',
      context: 'mothership',
      chatId: 'chat-1',
      originalName: 'bundle.zip',
      displayName: 'bundle.zip',
      contentType: 'application/zip',
      size: 2048,
      deletedAt: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await executeMaterializeFile({ fileNames: ['bundle.zip'] }, context)

    expect(result.success).toBe(false)
    const output = result.output as { failed: Array<{ fileName: string; error: string }> }
    expect(output.failed[0].error).toContain('operation: "extract"')
    expect(mockDecompress).not.toHaveBeenCalled()
  })
})
