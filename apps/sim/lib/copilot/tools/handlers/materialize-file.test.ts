/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUpload, mockFindOutput, mockAllocateName } = vi.hoisted(() => ({
  mockFindUpload: vi.fn(),
  mockFindOutput: vi.fn(),
  mockAllocateName: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/copilot/tools/handlers/chat-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
  findChatOutputRowByChatAndName: mockFindOutput,
  resolveChatUploadRecord: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  allocateUniqueWorkspaceFileName: mockAllocateName,
}))

vi.mock('@/lib/copilot/vfs/path-utils', () => ({
  canonicalWorkspaceFilePath: vi.fn(),
  // Real (pure) namespace helpers so save's prefix/ambiguity routing runs.
  isUploadsPath: (p: string) => !!p && p.trim().replace(/^\/+/, '').startsWith('uploads/'),
  isOutputsPath: (p: string) => !!p && p.trim().replace(/^\/+/, '').startsWith('outputs/'),
  chatScopedLeafSegment: (p: string, ns: 'uploads' | 'outputs') => {
    const normalized = p.trim().replace(/^\/+/, '')
    const prefix = `${ns}/`
    return normalized.startsWith(prefix)
      ? (normalized.slice(prefix.length).split('/')[0] ?? '')
      : ''
  },
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

describe('executeMaterializeFile - save clears chat provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('nulls both chatId and messageId when promoting an upload to the workspace', async () => {
    mockFindUpload.mockResolvedValue({
      id: 'wf_1',
      key: 'mothership/chat-1/cat.png',
      workspaceId: 'ws-1',
      folderId: null,
      userId: 'user-1',
      originalName: 'cat.png',
      displayName: 'cat.png',
      contentType: 'image/png',
      size: 10,
      deletedAt: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    })
    mockAllocateName.mockResolvedValue('cat.png')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'wf_1', originalName: 'cat.png' }])

    const result = await executeMaterializeFile({ fileNames: ['cat.png'] }, context)

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'workspace', chatId: null, messageId: null })
    )
  })
})

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
