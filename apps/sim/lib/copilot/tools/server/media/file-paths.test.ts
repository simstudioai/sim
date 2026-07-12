/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveChatUpload: vi.fn(),
  resolveWorkspaceFileReference: vi.fn(),
  validateWorkspaceFileWriteTarget: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  resolveChatUpload: mocks.resolveChatUpload,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  validateWorkspaceFileWriteTarget: mocks.validateWorkspaceFileWriteTarget,
}))

import {
  getSingleMediaFileDeclaration,
  resolveMediaInputFile,
  validateMediaOutputFile,
} from '@/lib/copilot/tools/server/media/file-paths'

const FILE_RECORD = { id: 'wf_file', name: 'portrait.png' }

describe('media file paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateWorkspaceFileWriteTarget.mockResolvedValue({})
  })

  it('resolves uploads/ inputs within the current chat', async () => {
    mocks.resolveChatUpload.mockResolvedValue(FILE_RECORD)

    await expect(
      resolveMediaInputFile({
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        path: 'uploads/My%20Portrait.png',
      })
    ).resolves.toBe(FILE_RECORD)

    expect(mocks.resolveChatUpload).toHaveBeenCalledWith('My%20Portrait.png', 'chat-1')
    expect(mocks.resolveWorkspaceFileReference).not.toHaveBeenCalled()
  })

  it('rejects unresolved inputs instead of dropping them', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue(null)

    await expect(
      resolveMediaInputFile({
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        path: 'files/missing.png',
      })
    ).rejects.toThrow('Input file not found: files/missing.png')
  })

  it('preserves legacy workspace IDs and plain-name references', async () => {
    mocks.resolveWorkspaceFileReference.mockResolvedValue(FILE_RECORD)

    await expect(
      resolveMediaInputFile({
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        path: 'portrait.png',
      })
    ).resolves.toBe(FILE_RECORD)

    await resolveMediaInputFile({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      path: 'wf_file',
    })

    expect(mocks.resolveWorkspaceFileReference).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      'portrait.png'
    )
    expect(mocks.resolveWorkspaceFileReference).toHaveBeenNthCalledWith(2, 'workspace-1', 'wf_file')
  })

  it('preflights outputs through the canonical workspace writer policy', async () => {
    await validateMediaOutputFile({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      path: 'files/Campaign/portrait.png',
      mode: 'overwrite',
      mimeType: 'image/png',
    })

    expect(mocks.validateWorkspaceFileWriteTarget).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Campaign/portrait.png',
        mode: 'overwrite',
        mimeType: 'image/png',
      },
    })
  })

  it('rejects uploads/ output paths before canonical resolution', async () => {
    await expect(
      validateMediaOutputFile({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        path: 'uploads/portrait.png',
        mode: 'create',
      })
    ).rejects.toThrow('Media output paths must start with "files/"')
    expect(mocks.validateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
  })

  it('propagates canonical writer validation errors for files/ paths', async () => {
    mocks.validateWorkspaceFileWriteTarget.mockRejectedValue(
      new Error('File already exists at files/portrait.png')
    )

    await expect(
      validateMediaOutputFile({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        path: 'files/portrait.png',
        mode: 'create',
      })
    ).rejects.toThrow('File already exists at files/portrait.png')
    expect(mocks.validateWorkspaceFileWriteTarget).toHaveBeenCalledOnce()
  })

  it('rejects non-file output namespaces before canonical resolution', async () => {
    await expect(
      validateMediaOutputFile({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        path: 'workflows/My%20Flow/state.json',
        mode: 'overwrite',
      })
    ).rejects.toThrow('Media output paths must start with "files/"')
    expect(mocks.validateWorkspaceFileWriteTarget).not.toHaveBeenCalled()
  })

  it('rejects extra declarations for single-file media parameters', () => {
    expect(() =>
      getSingleMediaFileDeclaration([{ path: 'files/a.png' }, { path: 'files/b.png' }], 'Output')
    ).toThrow('Output requires exactly one file; received 2')
    expect(() => getSingleMediaFileDeclaration([], 'Output')).toThrow(
      'Output requires exactly one file; received 0'
    )
  })
})
