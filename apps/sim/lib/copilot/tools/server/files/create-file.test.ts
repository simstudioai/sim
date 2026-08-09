/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureWorkspaceAccess, mockWriteWorkspaceFileByPath } = vi.hoisted(() => ({
  mockEnsureWorkspaceAccess: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mockEnsureWorkspaceAccess,
}))
vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))

import { createFileServerTool } from '@/lib/copilot/tools/server/files/create-file'

const context = { userId: 'user-1', workspaceId: 'ws-1' }

describe('createFileServerTool required MIME', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureWorkspaceAccess.mockResolvedValue({ role: 'admin' })
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'file-1',
      name: 'notes.md',
      vfsPath: 'files/notes.md',
    })
  })

  it('fails without a declared MIME instead of inferring from the extension', async () => {
    const result = await createFileServerTool.execute(
      { outputs: { files: [{ path: 'files/notes.md', mode: 'create' }] } } as never,
      context
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('requires an explicit MIME type')
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('rejects a malformed MIME instead of storing it verbatim', async () => {
    const result = await createFileServerTool.execute(
      {
        outputs: { files: [{ path: 'files/notes.md', mode: 'create', mimeType: 'markdown' }] },
      } as never,
      context
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('Invalid MIME type "markdown"')
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('normalizes casing and parameters before the MIME becomes the stored type', async () => {
    const result = await createFileServerTool.execute(
      {
        outputs: {
          files: [
            { path: 'files/notes.md', mode: 'create', mimeType: 'TEXT/MARKDOWN; charset=UTF-8' },
          ],
        },
      } as never,
      context
    )

    expect(result.success).toBe(true)
    const args = mockWriteWorkspaceFileByPath.mock.calls[0][0]
    expect(args.inferredMimeType).toBe('text/markdown')
    expect(args.target.mimeType).toBe('text/markdown')
    expect(result.data?.contentType).toBe('text/markdown')
  })

  it('accepts the legacy fileName + contentType combination', async () => {
    const result = await createFileServerTool.execute(
      { fileName: 'notes.md', contentType: 'text/markdown' } as never,
      context
    )

    expect(result.success).toBe(true)
    const args = mockWriteWorkspaceFileByPath.mock.calls[0][0]
    expect(args.target.path).toBe('files/notes.md')
    expect(args.target.mimeType).toBeUndefined()
    expect(args.inferredMimeType).toBe('text/markdown')
  })

  it('still requires a path or fileName', async () => {
    const result = await createFileServerTool.execute({} as never, context)

    expect(result.success).toBe(false)
    expect(result.message).toContain('outputs.files[0].path or fileName')
  })
})
