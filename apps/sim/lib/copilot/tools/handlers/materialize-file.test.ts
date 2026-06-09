/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUpload } = vi.hoisted(() => ({
  mockFindUpload: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  findMothershipUploadRowByChatAndName: mockFindUpload,
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: () => '/api/files/serve/',
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
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
