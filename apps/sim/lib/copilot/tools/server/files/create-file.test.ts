/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureWorkspaceAccess, mockWriteWorkspaceFileByPath, mockInferContentType } =
  vi.hoisted(() => ({
    mockEnsureWorkspaceAccess: vi.fn(),
    mockWriteWorkspaceFileByPath: vi.fn(),
    mockInferContentType: vi.fn(() => 'text/markdown'),
  }))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mockEnsureWorkspaceAccess,
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))

vi.mock('@/lib/copilot/tools/server/files/workspace-file', () => ({
  inferContentType: mockInferContentType,
}))

import { createFileServerTool } from '@/lib/copilot/tools/server/files/create-file'

const CONTEXT = { userId: 'user-1', workspaceId: 'ws-1' }

describe('create_file outputs/ guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureWorkspaceAccess.mockResolvedValue(undefined)
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'wf_new',
      name: 'notes.md',
      vfsPath: 'files/notes.md',
    })
  })

  it('rejects a bare fileName targeting outputs/ BEFORE the files/ prefixing', async () => {
    // Pre-fix, "outputs/notes.md" became "files/outputs/notes.md" before the
    // guard ran, slipping past it into a literal files/outputs/ folder.
    const result = await createFileServerTool.execute(
      { fileName: 'outputs/notes.md' },
      CONTEXT as never
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('create_file cannot target outputs/')
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('rejects the structured outputs.files[0].path form targeting outputs/', async () => {
    const result = await createFileServerTool.execute(
      { fileName: '', outputs: { files: [{ path: 'outputs/notes.md' }] } },
      CONTEXT as never
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('create_file cannot target outputs/')
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('rejects spelling variants with leading slashes or whitespace', async () => {
    const result = await createFileServerTool.execute(
      { fileName: ' /outputs/notes.md' },
      CONTEXT as never
    )

    expect(result.success).toBe(false)
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('creates a normal file, prefixing bare names with files/', async () => {
    const result = await createFileServerTool.execute({ fileName: 'notes.md' }, CONTEXT as never)

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ path: 'files/notes.md' }) })
    )
  })
})
