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

  /**
   * The response is marked immutable only when the URL names the object that was streamed. The key is
   * resolved to a file and the file's CURRENT key is what gets downloaded, so a rotation landing
   * between those two reads would serve new bytes under a URL naming the old object — cached, that
   * would be wrong forever.
   */
  it('is content-addressed only when the requested key is the one it streamed', async () => {
    mockGetMetadataByKey.mockResolvedValue({ id: 'f1', workspaceId: 'ws-1' })

    const match = await readWorkspaceInlineFile.execute({
      principal,
      input: { workspaceId: 'ws-1', key: file.key },
    })
    expect(match.contentAddressed).toBe(true)

    // The file's content was replaced between resolving the key and reading the row.
    mockGetWorkspaceFile.mockResolvedValue({ ...file, key: 'workspace/ws-1/rotated-photo.png' })
    const rotated = await readWorkspaceInlineFile.execute({
      principal,
      input: { workspaceId: 'ws-1', key: file.key },
    })
    expect(rotated.contentAddressed).toBe(false)
  })

  it('is never content-addressed when the caller named the file rather than an object', async () => {
    const result = await readWorkspaceInlineFile.execute({
      principal,
      input: { workspaceId: 'ws-1', fileId: 'f1' },
    })

    expect(result.contentAddressed).toBe(false)
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
