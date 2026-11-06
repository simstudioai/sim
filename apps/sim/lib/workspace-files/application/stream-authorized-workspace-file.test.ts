import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { fileReadReceiptMock } from '@sim/testing/mocks/file-read-receipt.mock'
import { uploadsConfigMock, uploadsConfigMockFns } from '@sim/testing/mocks/uploads-config.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
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
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { streamAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/stream-authorized-workspace-file'

const CONTENT = Buffer.from('0123456789abcdefghij')

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'clip.mp4',
  key: 'workspace/workspace-1/clip.mp4',
  path: '/api/files/serve/workspace/workspace-1/clip.mp4',
  size: CONTENT.length,
  type: 'video/mp4',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
} satisfies WorkspaceFileRecord

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer())
}

describe('streamAuthorizedWorkspaceFile', () => {
  beforeEach(() => {
    const uploads = mkdtempSync(join(tmpdir(), 'stream-authorized-'))
    mkdirSync(dirname(join(uploads, file.key)), { recursive: true })
    writeFileSync(join(uploads, file.key), CONTENT)
    setUploadDirServer(uploads)
    uploadsConfigMockFns.mockGetStorageConfig.mockReturnValue({ bucket: 'b', region: 'r' })
  })

  it('streams every stored byte once access still holds after storage opens', async () => {
    const stream = await streamAuthorizedWorkspaceFile({
      file,
      principal: createSessionPrincipal(),
      authorize: async () => undefined,
    })

    expect(await readAll(stream)).toEqual(CONTENT)
  })

  it('reads exactly the requested inclusive span and nothing else', async () => {
    const stream = await streamAuthorizedWorkspaceFile({
      file,
      principal: createSessionPrincipal(),
      authorize: async () => undefined,
      range: { start: 5, end: 9 },
    })

    expect((await readAll(stream)).toString()).toBe('56789')
  })

  it('disposes the opened stream when access is revoked before it is handed out', async () => {
    const cancel = vi.spyOn(ReadableStream.prototype, 'cancel')

    await expect(
      streamAuthorizedWorkspaceFile({
        file,
        principal: createSessionPrincipal(),
        authorize: async () => {
          throw new Error('revoked')
        },
      })
    ).rejects.toThrow('revoked')
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })

  it('refuses and disposes the stream when provenance changes after storage opens', async () => {
    const chat = createDelegatedPrincipal({ audience: WORKSPACE_FILES_DELEGATION_AUDIENCE })
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue(
      { status: 'exact', entries: [] }
    )
    vi.mocked(recheckFileReadReceipt).mockResolvedValueOnce({ status: 'unknown' })
    const cancel = vi.spyOn(ReadableStream.prototype, 'cancel')

    await expect(
      observeContentDelivery(
        { admit: async (sources) => sources.map((entry) => entry.provenance.status === 'exact') },
        () =>
          streamAuthorizedWorkspaceFile({ file, principal: chat, authorize: async () => undefined })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })
})
