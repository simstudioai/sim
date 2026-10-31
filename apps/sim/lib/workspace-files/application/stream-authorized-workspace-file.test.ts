import { Readable } from 'node:stream'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { fileReadReceiptMock } from '@sim/testing/mocks/file-read-receipt.mock'
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
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { streamAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/stream-authorized-workspace-file'

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'clip.mp4',
  key: 'workspace/workspace-1/clip.mp4',
  path: '/api/files/serve/workspace/workspace-1/clip.mp4',
  size: 6,
  type: 'video/mp4',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
} satisfies WorkspaceFileRecord

let source: Readable

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString()
}

describe('streamAuthorizedWorkspaceFile', () => {
  beforeEach(() => {
    source = Readable.from([Buffer.from('stream')])
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(source)
  })

  it('streams the stored bytes once access still holds after storage opens', async () => {
    const stream = await streamAuthorizedWorkspaceFile({
      file,
      principal: createSessionPrincipal(),
      authorize: async () => undefined,
    })
    await expect(readAll(stream)).resolves.toBe('stream')
  })

  it('reads only the requested span from storage', async () => {
    await streamAuthorizedWorkspaceFile({
      file,
      principal: createSessionPrincipal(),
      authorize: async () => undefined,
      range: { start: 2, end: 4 },
    })
    expect(storageServiceMockFns.mockDownloadFileStream).toHaveBeenCalledWith({
      key: file.key,
      context: 'workspace',
      range: { start: 2, end: 4 },
    })
  })

  it('disposes the opened stream when access is revoked before it is handed out', async () => {
    await expect(
      streamAuthorizedWorkspaceFile({
        file,
        principal: createSessionPrincipal(),
        authorize: async () => {
          throw new Error('revoked')
        },
      })
    ).rejects.toThrow('revoked')
    expect(source.destroyed).toBe(true)
  })

  it('refuses and disposes the stream when provenance changes after storage opens', async () => {
    const chat = createDelegatedPrincipal({ audience: WORKSPACE_FILES_DELEGATION_AUDIENCE })
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue(
      { status: 'exact', entries: [] }
    )
    vi.mocked(recheckFileReadReceipt).mockResolvedValueOnce({ status: 'unknown' })

    await expect(
      observeContentDelivery(
        { admit: async (sources) => sources.map((entry) => entry.provenance.status === 'exact') },
        () =>
          streamAuthorizedWorkspaceFile({ file, principal: chat, authorize: async () => undefined })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(source.destroyed).toBe(true)
  })
})
