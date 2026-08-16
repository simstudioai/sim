/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeDocNotReadyError extends Error {}

const mocks = vi.hoisted(() => ({
  downloadStream: vi.fn(),
  fetchServable: vi.fn(),
  getFile: vi.fn(),
  loadContext: vi.fn(),
  recordAudit: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_DOWNLOADED: 'FILE_DOWNLOADED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/workspace-files/application/fetch-servable-workspace-file-buffer', () => ({
  fetchAuthorizedServableWorkspaceFileBuffer: mocks.fetchServable,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.downloadStream,
}))

vi.mock('@/lib/uploads/utils/doc-not-ready', () => ({
  isDocNotReadyError: (error: unknown) => error instanceof FakeDocNotReadyError,
  docNotReadyMessage: () => 'A document is still being generated.',
}))

import { MAX_RENDERED_DOCUMENT_BYTES } from '@/lib/uploads/utils/file-utils'
import {
  downloadWorkspaceFile,
  downloadWorkspaceFileStream,
} from '@/lib/workspace-files/application/download-workspace-file'

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

const SESSION = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

function downloadStream(fileId: string) {
  return downloadWorkspaceFileStream.execute({ principal: SESSION, input: { fileId } })
}

describe('workspace file downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
    mocks.downloadStream.mockResolvedValue(Readable.from(Buffer.from('pdf')))
    mocks.fetchServable.mockResolvedValue({
      buffer: Buffer.from('%PDF-compiled'),
      contentType: 'application/pdf',
    })
  })

  it('returns the authoritative file and records its semantic download audit', async () => {
    await expect(
      downloadWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ file })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        action: 'FILE_DOWNLOADED',
        resourceId: 'file-1',
        resourceName: 'report.pdf',
        metadata: expect.objectContaining({
          operation: 'files.download',
          fileId: 'file-1',
          fileName: 'report.pdf',
          bytes: 42,
        }),
      })
    )
  })

  it('does not audit a streaming download when storage acquisition fails', async () => {
    mocks.getFile.mockResolvedValue(plainFile)
    const failure = new Error('storage unavailable')
    mocks.downloadStream.mockRejectedValueOnce(failure)

    await expect(downloadStream('file-2')).rejects.toBe(failure)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
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

  /** Legacy records carry no type, so the extension is the only signal left. */
  it('routes a record with no content type by its extension', async () => {
    await downloadStream('file-1')

    expect(mocks.fetchServable).toHaveBeenCalledWith(file, SESSION, expect.anything())
    expect(mocks.downloadStream).not.toHaveBeenCalled()
  })

  it('surfaces a still-compiling generated doc as a retryable conflict', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)
    mocks.fetchServable.mockRejectedValueOnce(new FakeDocNotReadyError('still compiling'))

    await expect(downloadStream('file-3')).rejects.toMatchObject({
      name: 'OrchestrationError',
      code: 'conflict',
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates a genuine artifact-resolution failure unchanged', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)
    const failure = new Error('artifact store unavailable')
    mocks.fetchServable.mockRejectedValueOnce(failure)

    await expect(downloadStream('file-3')).rejects.toBe(failure)
  })

  it('audits the bytes actually served, not the generation source size', async () => {
    mocks.getFile.mockResolvedValue(generatedDoc)

    await downloadStream('file-3')

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ bytes: '%PDF-compiled'.length }),
      })
    )
  })
})
