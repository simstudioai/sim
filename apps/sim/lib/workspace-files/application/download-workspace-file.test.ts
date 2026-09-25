import { Readable } from 'node:stream'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
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
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'

class FakeDocNotReadyError extends Error {}

const hoisted = vi.hoisted(() => ({
  fetchServable: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: hoisted.fetchServable,
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/utils/doc-not-ready', () => ({
  isDocNotReadyError: (error: unknown) => error instanceof FakeDocNotReadyError,
  docNotReadyMessage: () => 'A document is still being generated.',
}))

import { MAX_RENDERED_DOCUMENT_BYTES } from '@/lib/uploads/utils/file-utils'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'

const mocks = {
  provenance: workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
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

  it('observes canonical private provenance before returning while keeping public results unchanged', async () => {
    const provenance = { status: 'exact', entries: [] }
    mocks.provenance.mockResolvedValue(provenance)
    const observe = vi.fn(async () => {})
    const result = await observeWorkspaceFileDelivery(observe, () => downloadStream('file-2'))
    expect(observe).toHaveBeenCalledWith(provenance)
    expect(result.secretProvenance).toBeUndefined()
  })
  it('does not return content if the private delivery observer refuses', async () => {
    mocks.provenance.mockResolvedValue({ status: 'unknown' })
    await expect(
      observeWorkspaceFileDelivery(
        async () => {
          throw new Error('no evidence')
        },
        () => downloadStream('file-2')
      )
    ).rejects.toThrow('no evidence')
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
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
