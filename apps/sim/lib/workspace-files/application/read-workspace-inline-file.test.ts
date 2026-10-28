import { Readable } from 'node:stream'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { fileReadReceiptMock } from '@sim/testing/mocks/file-read-receipt.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContentRefusedError,
  observeContentDelivery,
} from '@/lib/core/application/content-delivery'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { recheckFileReadReceipt } from '@/lib/workspace-files/read-receipt'

vi.mock('@/lib/workspace-files/read-receipt', () => fileReadReceiptMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'

const mockDownloadFileStream = storageServiceMockFns.mockDownloadFileStream

const mockGetMetadataByKey = uploadsMetadataMockFns.mockGetFileMetadataByKey

const mockGetWorkspaceFile = workspaceFileManagerMockFns.mockGetWorkspaceFile
const mockLoadContext = workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext

workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')

const principal = createSessionPrincipal({ userId: 'u1', sessionId: 's1' })
const file = {
  id: 'f1',
  workspaceId: 'ws-1',
  key: 'workspace/ws-1/photo.png',
  name: 'photo.png',
  type: 'image/png',
}

describe('readWorkspaceInlineFile', () => {
  beforeEach(() => {
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

  it('refuses bytes when final receipt provenance changes after storage opens', async () => {
    const chat = createDelegatedPrincipal({
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      workspaceId: 'ws-1',
    })
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue(
      { status: 'exact', entries: [] }
    )
    vi.mocked(recheckFileReadReceipt).mockResolvedValueOnce({ status: 'unknown' })
    await expect(
      observeContentDelivery(
        { admit: async (sources) => sources.map((source) => source.provenance.status === 'exact') },
        () =>
          readWorkspaceInlineFile.execute({
            principal: chat,
            input: { workspaceId: 'ws-1', fileId: 'f1' },
          })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(mockDownloadFileStream).toHaveBeenCalled()
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
