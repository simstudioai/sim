/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuotaForBillingContext,
  mockFindUpload,
  mockHasCloudStorage,
  mockHeadObject,
  mockIncrementStorageUsageForBillingContextInTx,
  mockMaybeNotifyStorageLimitForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockFindUpload: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockHeadObject: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
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
  canonicalWorkspaceFilePath: vi.fn(() => 'files/report.txt'),
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
} as ExecutionContext

const STORAGE_CONTEXT = {
  workspaceId: 'ws-1',
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'organization' as const, id: 'workspace-org' },
  plan: 'team_25000',
  customStorageLimitGB: null,
}

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
    expect(result.error).toContain('Unsupported materialize_file operation "table"')
    expect(result.error).toContain('table subagent')
    expect(mockFindUpload).not.toHaveBeenCalled()
  })

  it('rejects the knowledge_base operation and points to the knowledge subagent', async () => {
    const result = await executeMaterializeFile(
      { fileNames: ['data.csv'], operation: 'knowledge_base' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported materialize_file operation "knowledge_base"')
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
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'workspace', chatId: null, size: 250 })
    )
    expect(mockMaybeNotifyStorageLimitForBillingContext).toHaveBeenCalledWith(
      STORAGE_CONTEXT,
      1_250
    )
  })

  it('treats a lost conditional transition as a replay no-op', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await executeMaterializeFile(
      { fileNames: ['report.txt'], operation: 'save' },
      context
    )

    expect(result.success).toBe(true)
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
