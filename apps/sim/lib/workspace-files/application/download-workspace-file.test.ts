import { Readable } from 'node:stream'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { fileReadReceiptMock } from '@sim/testing/mocks/file-read-receipt.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
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
  ContentDeliveryUnobservedError,
  ContentRefusedError,
  type ContentSource,
  observeContentDelivery,
} from '@/lib/core/application'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import {
  assertFileReadReceiptCurrent,
  recheckFileReadReceipt,
} from '@/lib/workspace-files/read-receipt'

class FakeDocNotReadyError extends Error {}

const hoisted = vi.hoisted(() => ({
  fetchServable: vi.fn(),
}))

vi.mock('@/lib/workspace-files/read-receipt', () => fileReadReceiptMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/uploads/contexts/workspace/file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: hoisted.fetchServable,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/utils/doc-not-ready', () => ({
  isDocNotReadyError: (error: unknown) => error instanceof FakeDocNotReadyError,
  docNotReadyMessage: () => 'A document is still being generated.',
}))

import { MAX_RENDERED_DOCUMENT_BYTES } from '@/lib/uploads/utils/file'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'

const mocks = {
  provenance: workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
  byIdentity:
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenanceByIdentity,
  downloadStream: storageServiceMockFns.mockDownloadFileStream,
  getFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  ...hoisted,
  recordAudit: auditMockFns.mockRecordAudit,
}

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'report.pdf',
  key: 'workspace/workspace-1/report.pdf',
  size: 42,
  storageContext: 'workspace',
}

/** A name the generated-doc resolver does not claim, so it streams raw. */
const plainFile = {
  id: 'file-2',
  workspaceId: 'workspace-1',
  name: 'data.csv',
  key: 'workspace/workspace-1/data.csv',
  size: 12,
  type: 'text/csv',
  storageContext: 'workspace',
}

/** Stored bytes are a generation source, so the artifact must be resolved. */
const generatedDoc = {
  ...file,
  id: 'file-3',
  type: 'text/x-python-pdf',
}

/**
 * A real uploaded PDF. Shares the generated doc's extension but carries final
 * bytes, so it must keep streaming rather than being materialized.
 */
const uploadedPdf = {
  id: 'file-4',
  workspaceId: 'workspace-1',
  name: 'manual.pdf',
  key: 'workspace/workspace-1/manual.pdf',
  size: 900,
  type: 'application/pdf',
  storageContext: 'workspace',
}

const SESSION = createSessionPrincipal()
const CHAT = createDelegatedPrincipal({ audience: WORKSPACE_FILES_DELEGATION_AUDIENCE })

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

function downloadStream(fileId: string) {
  return downloadWorkspaceFileStream.execute({ principal: SESSION, input: { fileId } })
}

describe('workspace file downloads', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
    mocks.downloadStream.mockResolvedValue(Readable.from(Buffer.from('pdf')))
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-compiled'),
      contentType: 'application/pdf',
    })
  })

  it('classifies a Chat download by its canonical provenance before opening storage', async () => {
    const provenance = { status: 'exact', entries: [] }
    mocks.provenance.mockResolvedValue(provenance)
    mocks.getFile.mockResolvedValue(plainFile)
    const admit = vi.fn(async (sources: readonly ContentSource[]) => sources.map(() => true))
    const result = await observeContentDelivery({ admit }, () =>
      downloadWorkspaceFileStream.execute({ principal: CHAT, input: { fileId: plainFile.id } })
    )
    expect(admit).toHaveBeenCalledWith([
      { kind: 'workspace-file', id: plainFile.id, provenance, view: 'opaque' },
    ])
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadStream.mock.invocationCallOrder[0]
    )
    expect(result.contentType).toBe('text/csv')
  })

  it('refuses a Chat download its gate refuses with a 403, before opening storage', async () => {
    mocks.provenance.mockResolvedValue({ status: 'unknown' })
    mocks.getFile.mockResolvedValue(plainFile)
    await expect(
      observeContentDelivery({ admit: async (sources) => sources.map(() => false) }, () =>
        downloadWorkspaceFileStream.execute({ principal: CHAT, input: { fileId: plainFile.id } })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(mocks.downloadStream).not.toHaveBeenCalled()
  })

  it('refuses raw bytes when final receipt provenance is no longer admitted', async () => {
    mocks.getFile.mockResolvedValue(plainFile)
    mocks.provenance.mockResolvedValue({ status: 'exact', entries: [] })
    vi.mocked(recheckFileReadReceipt).mockResolvedValueOnce({
      status: 'unknown',
    })
    await expect(
      observeContentDelivery(
        { admit: async (sources) => sources.map((source) => source.provenance.status === 'exact') },
        () =>
          downloadWorkspaceFileStream.execute({ principal: CHAT, input: { fileId: plainFile.id } })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
    expect(mocks.downloadStream).toHaveBeenCalled()
  })

  it('refuses a Chat download no gate observes', async () => {
    mocks.getFile.mockResolvedValue(plainFile)
    await expect(
      downloadWorkspaceFileStream.execute({ principal: CHAT, input: { fileId: plainFile.id } })
    ).rejects.toBeInstanceOf(ContentDeliveryUnobservedError)
    expect(mocks.provenance).not.toHaveBeenCalled()
    expect(mocks.downloadStream).not.toHaveBeenCalled()
  })

  it('refuses a rendered document for Chat when a file it embeds is refused', async () => {
    const embedded = {
      fileId: 'file-embedded',
      key: 'workspace/workspace-1/logo.png',
      context: 'workspace' as const,
    }
    mocks.getFile.mockResolvedValue(generatedDoc)
    mocks.provenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-compiled'),
      contentType: 'application/pdf',
      contributingFiles: [embedded],
    })
    mocks.byIdentity.mockResolvedValue(new Map([[embedded.fileId, { status: 'unknown' }]]))
    await expect(
      observeContentDelivery(
        {
          admit: async (sources) => sources.map((source) => source.provenance.status !== 'unknown'),
        },
        () => downloadWorkspaceFileStream.execute({ principal: CHAT, input: { fileId: 'file-3' } })
      )
    ).rejects.toBeInstanceOf(ContentRefusedError)
  })

  it('rejects a session download whose files changed after authorization', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-compiled'),
      contentType: 'application/pdf',
      receipt: {
        owner: { entityType: 'workspace', entityId: 'workspace-1' },
        files: [
          { id: generatedDoc.id, key: generatedDoc.key, revision: 1 },
          { id: 'file-embedded', key: 'workspace/workspace-1/logo.png', revision: 1 },
        ],
      },
    })
    vi.mocked(assertFileReadReceiptCurrent).mockRejectedValueOnce(new Error('A file changed'))

    await expect(downloadStream(generatedDoc.id)).rejects.toThrow('A file changed')
  })

  it('reads no provenance for a session download, which no gate classifies', async () => {
    mocks.getFile.mockResolvedValue(plainFile)
    const result = await downloadStream(plainFile.id)
    expect(await readAll(result.stream)).toBe('pdf')
    expect(mocks.provenance).not.toHaveBeenCalled()
  })

  /** Resolving an artifact costs a full buffer, so it is reserved for generation sources. */
  it.each([
    { label: 'an ordinary file', record: plainFile, type: 'text/csv', size: 12 },
    { label: 'a genuinely uploaded pdf', record: uploadedPdf, type: 'application/pdf', size: 900 },
  ])('streams $label straight from storage', async ({ record, type, size }) => {
    mocks.getFile.mockResolvedValue(record)

    const result = await downloadStream(record.id)

    expect(mocks.fetchServable).not.toHaveBeenCalled()
    expect(mocks.downloadStream).toHaveBeenCalledWith({
      key: record.key,
      context: 'workspace',
    })
    expect(result.contentType).toBe(type)
    expect(result.contentLength).toBe(size)
  })

  /**
   * Regression: a raw stream of a generated doc's key yields its generation
   * source under a `.pdf` name — a file the recipient cannot open.
   */
  it('serves the compiled artifact for a generated doc rather than its source', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)

    const result = await downloadStream('file-3')

    expect(mocks.downloadStream).not.toHaveBeenCalled()
    expect(await readAll(result.stream)).toBe('%PDF-compiled')
    expect(result.contentType).toBe('application/pdf')
    expect(result.contentLength).toBe('%PDF-compiled'.length)
    expect(result.contentLength).not.toBe(generatedDoc.size)
  })

  it('caps the artifact it will materialize', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)

    await downloadStream('file-3')

    expect(mocks.fetchServable).toHaveBeenCalledWith(
      generatedDoc,
      SESSION,
      expect.objectContaining({ maxBytes: MAX_RENDERED_DOCUMENT_BYTES })
    )
  })
})

vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
