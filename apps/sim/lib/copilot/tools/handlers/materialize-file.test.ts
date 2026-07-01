/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUpload, mockFetchBuffer, mockDecompress } = vi.hoisted(() => ({
  mockFindUpload: vi.fn(),
  mockFetchBuffer: vi.fn(),
  mockDecompress: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchBuffer,
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
  MAX_ARCHIVE_ENTRIES: 1000,
  MAX_ARCHIVE_ENTRY_BYTES: 100 * 1024 * 1024,
  MAX_ARCHIVE_TOTAL_BYTES: 200 * 1024 * 1024,
}))

vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  canonicalWorkspaceFilePath: vi.fn(),
}))

vi.mock('@/lib/workflows/operations/import-export', () => ({ parseWorkflowJson: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ saveWorkflowToNormalizedTables: vi.fn() }))
vi.mock('@/lib/workflows/utils', () => ({ deduplicateWorkflowName: vi.fn() }))
vi.mock('@/app/api/v1/admin/types', () => ({ extractWorkflowMetadata: vi.fn() }))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeMaterializeFile } from '@/lib/copilot/tools/handlers/materialize-file'

const context = {
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  workflowId: 'wf-1',
} as ExecutionContext

describe('executeMaterializeFile - unsupported operation', () => {
  beforeEach(() => vi.clearAllMocks())

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

describe('executeMaterializeFile - extract operation', () => {
  beforeEach(() => vi.clearAllMocks())

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
      rootFolderPath: 'files/bundle',
    })

    const result = await executeMaterializeFile(
      { fileNames: ['bundle.zip'], operation: 'extract' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockDecompress).toHaveBeenCalledTimes(1)
    // Dispatches into files/<archive>/ and drops macOS/Windows noise entries.
    expect(mockDecompress).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-1',
        rootFolderSegments: ['bundle'],
        skipNoiseEntries: true,
      })
    )
    expect(result.output).toMatchObject({ succeeded: ['bundle.zip'], failed: [] })
    // Mirrors executeSave: extracted files surface as file resources.
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
})
