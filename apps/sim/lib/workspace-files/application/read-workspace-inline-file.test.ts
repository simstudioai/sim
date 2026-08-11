/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadContext, mockGetWorkspaceFile, mockGetMetadataByKey, mockDownloadFileStream } =
  vi.hoisted(() => ({
    mockLoadContext: vi.fn(),
    mockGetWorkspaceFile: vi.fn(),
    mockGetMetadataByKey: vi.fn(),
    mockDownloadFileStream: vi.fn(),
  }))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: vi.fn().mockResolvedValue('admin'),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
  loadActiveWorkspaceFileContext: mockLoadContext,
}))
vi.mock('@/lib/uploads/server/metadata', () => ({ getFileMetadataByKey: mockGetMetadataByKey }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mockDownloadFileStream,
}))

import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'

const principal = { kind: 'session' as const, userId: 'u1', sessionId: 's1' }
const file = {
  id: 'f1',
  workspaceId: 'ws-1',
  key: 'workspace/ws-1/photo.png',
  name: 'photo.png',
  type: 'image/png',
}

describe('readWorkspaceInlineFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadContext.mockResolvedValue({
      fileId: 'f1',
      workspaceId: 'ws-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mockGetWorkspaceFile.mockResolvedValue(file)
    mockDownloadFileStream.mockResolvedValue(Readable.from(Buffer.from('png')))
  })

  it('authorizes a file-id reference against the asserted workspace before reading bytes', async () => {
    const result = await readWorkspaceInlineFile.execute({
      principal,
      input: { workspaceId: 'ws-1', fileId: 'f1' },
    })

    expect(mockLoadContext).toHaveBeenCalledWith('f1')
    expect(mockDownloadFileStream).toHaveBeenCalledWith({
      key: file.key,
      context: 'workspace',
    })
    expect(Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(Buffer.from('png'))
  })

  it('resolves a storage-key reference to its canonical file id before authorizing', async () => {
    mockGetMetadataByKey.mockResolvedValue({ id: 'f1', workspaceId: 'ws-1' })

    await readWorkspaceInlineFile.execute({
      principal,
      input: { workspaceId: 'ws-1', key: file.key },
    })

    expect(mockGetMetadataByKey).toHaveBeenCalledWith(file.key, 'workspace')
    expect(mockLoadContext).toHaveBeenCalledWith('f1')
  })

  it('conceals a key belonging to another workspace before authorization', async () => {
    mockGetMetadataByKey.mockResolvedValue({ id: 'other', workspaceId: 'ws-other' })

    await expect(
      readWorkspaceInlineFile.execute({
        principal,
        input: { workspaceId: 'ws-1', key: 'workspace/ws-other/photo.png' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockLoadContext).not.toHaveBeenCalled()
    expect(mockDownloadFileStream).not.toHaveBeenCalled()
  })
})
