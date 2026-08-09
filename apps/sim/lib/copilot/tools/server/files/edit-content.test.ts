/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConsumeLatestFileIntent, mockUpdateWorkspaceFileContent } = vi.hoisted(() => ({
  mockConsumeLatestFileIntent: vi.fn(),
  mockUpdateWorkspaceFileContent: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isDocSandboxEnabled: false }))
vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  WorkspaceFile: { id: 'workspace_file' },
}))
vi.mock('@/lib/copilot/tools/handlers/access', () => ({ ensureWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/execution/sandbox/run-task', () => ({ runSandboxTask: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  getWorkspaceFile: vi.fn(),
  resolveWorkspaceFileReference: vi.fn(),
  updateWorkspaceFileContent: mockUpdateWorkspaceFileContent,
}))
vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: vi.fn(),
  performRenameWorkspaceFile: vi.fn(),
}))
vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  compileDoc: vi.fn(),
  getE2BDocFormat: vi.fn(async () => null),
  DocCompileUserError: class DocCompileUserError extends Error {},
  DOCXJS_SOURCE_MIME: 'text/x-docxjs',
  PPTXGENJS_SOURCE_MIME: 'text/x-pptxgenjs',
}))
vi.mock('@/lib/copilot/tools/server/files/embedded-image-refs', () => ({
  buildEmbeddedImageRefWarning: vi.fn(async () => ''),
}))
vi.mock('@/lib/copilot/tools/server/files/file-intent-store', () => ({
  consumeLatestFileIntent: mockConsumeLatestFileIntent,
  storeFileIntent: vi.fn(),
}))

import { editContentServerTool } from '@/lib/copilot/tools/server/files/edit-content'

/** Extension-less markdown file — the exact shape of the md->txt reversion regression. */
const markdownRecord = {
  id: 'file-1',
  workspaceId: 'ws-1',
  name: 'new-boi',
  key: 'workspace/ws-1/1-abc-new-boi',
  path: '/api/files/serve/workspace/ws-1/1-abc-new-boi',
  size: 10,
  type: 'text/markdown',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const context = { userId: 'user-1', workspaceId: 'ws-1' }

function intentWith(overrides: Record<string, unknown>) {
  return {
    operation: 'update',
    fileId: markdownRecord.id,
    workspaceId: 'ws-1',
    userId: 'user-1',
    fileRecord: markdownRecord,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('editContentServerTool stored-type preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateWorkspaceFileContent.mockResolvedValue(undefined)
  })

  it('preserves the stored type when the intent has no contentType (md->txt regression)', async () => {
    mockConsumeLatestFileIntent.mockResolvedValue(intentWith({}))

    const result = await editContentServerTool.execute({ content: '# hello' }, context)

    expect(result.success).toBe(true)
    expect(mockUpdateWorkspaceFileContent).toHaveBeenCalledTimes(1)
    const [, , , , storedMime] = mockUpdateWorkspaceFileContent.mock.calls[0]
    expect(storedMime).toBe('text/markdown')
    expect(result.data?.contentType).toBe('text/markdown')
  })

  it('applies an explicit intent contentType as a deliberate conversion', async () => {
    mockConsumeLatestFileIntent.mockResolvedValue(intentWith({ contentType: 'text/html' }))

    const result = await editContentServerTool.execute({ content: '<p>hi</p>' }, context)

    expect(result.success).toBe(true)
    const [, , , , storedMime] = mockUpdateWorkspaceFileContent.mock.calls[0]
    expect(storedMime).toBe('text/html')
  })

  it('preserves the stored type through a patch write', async () => {
    mockConsumeLatestFileIntent.mockResolvedValue(
      intentWith({
        operation: 'patch',
        existingContent: 'Hello World',
        edit: { strategy: 'search_replace', search: 'World' },
      })
    )

    const result = await editContentServerTool.execute({ content: 'Sim' }, context)

    expect(result.success).toBe(true)
    const [, , , buffer, storedMime] = mockUpdateWorkspaceFileContent.mock.calls[0]
    expect(buffer.toString('utf-8')).toBe('Hello Sim')
    expect(storedMime).toBe('text/markdown')
  })

  it('fails with guidance when no workspace_file intent exists', async () => {
    mockConsumeLatestFileIntent.mockResolvedValue(null)

    const result = await editContentServerTool.execute({ content: 'x' }, context)

    expect(result.success).toBe(false)
    expect(result.message).toContain('workspace_file')
    expect(mockUpdateWorkspaceFileContent).not.toHaveBeenCalled()
  })
})
