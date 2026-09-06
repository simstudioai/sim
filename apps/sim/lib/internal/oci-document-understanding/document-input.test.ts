/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authorize,
  principal,
  provenance,
  safeKey,
  safeContributor,
  download,
  openPdf,
  destroyPdf,
  imageMetadata,
} = vi.hoisted(() => ({
  authorize: vi.fn(),
  principal: vi.fn(),
  provenance: vi.fn(),
  safeKey: vi.fn(),
  safeContributor: vi.fn(),
  download: vi.fn(),
  openPdf: vi.fn(),
  destroyPdf: vi.fn(),
  imageMetadata: vi.fn(),
}))
vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  assertUserFileContentAccess: authorize,
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: principal,
}))
vi.mock('@sim/auth/principal', () => ({
  resolvePrincipalSubject: () => ({ kind: 'sim_user', userId: 'actor-1' }),
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: provenance,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: safeKey,
  isOpaqueWorkspaceFileEgressSafe: safeContributor,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'Unsafe workspace file',
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: download,
}))
vi.mock('@/lib/file-parsers/pdfjs-server', () => ({ openPdfDocument: openPdf }))
vi.mock('sharp', () => ({ default: () => ({ metadata: imageMetadata }) }))
vi.mock('@/lib/workspace-files/application/authorization', () => ({
  WORKSPACE_FILES_DELEGATION_AUDIENCE: 'workspace-files',
}))

import {
  prepareDocumentSource,
  validateDocumentBytes,
} from '@/lib/internal/oci-document-understanding/document-input'
import {
  type AnalysisInput,
  documentInputSchema,
} from '@/lib/internal/oci-document-understanding/schema'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const file = {
  id: 'file-1',
  name: 'invoice.pdf',
  key: 'workspace/workspace-1/file-1',
  url: 'https://untrusted.example/ignored',
  size: 12,
  type: 'application/pdf',
}
const call: InternalToolOperationCall = {
  toolId: 'oci_document_understanding_analyze_document',
  requestId: 'request-1',
  headers: new Headers(),
  context: {
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    userId: 'owner-not-actor',
  },
}
function input(values: Record<string, unknown> = {}): AnalysisInput {
  const parsed = documentInputSchema.parse({
    operation: 'analyze_document',
    credentialId: 'authorized',
    source: 'file',
    file,
    features: [{ featureType: 'TEXT_EXTRACTION' }],
    ...values,
  })
  if (parsed.operation !== 'analyze_document' && parsed.operation !== 'create_processor_job')
    throw new Error('Expected analysis')
  return parsed
}

describe('authorized document inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    principal.mockResolvedValue({ kind: 'session', userId: 'actor-1', sessionId: 'session-1' })
    provenance.mockReturnValue({ success: true })
    authorize.mockResolvedValue(undefined)
    safeKey.mockResolvedValue(true)
    safeContributor.mockResolvedValue(true)
    download.mockResolvedValue({ buffer: Buffer.from('%PDF-synthetic') })
    openPdf.mockResolvedValue({ numPages: 1, destroy: destroyPdf })
    imageMetadata.mockResolvedValue({ format: 'png', width: 100, height: 100 })
  })

  it('authorizes the stored file with the acting principal and bounds the shared download', async () => {
    const result = await prepareDocumentSource(input(), call)
    expect(authorize).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ userId: 'actor-1', workspaceId: 'workspace-1' })
    )
    expect(safeKey).toHaveBeenCalledWith(file.key, {
      workspaceId: 'workspace-1',
      actorUserId: 'actor-1',
    })
    expect(download).toHaveBeenCalledWith(
      file,
      'request-1',
      expect.anything(),
      expect.objectContaining({
        maxBytes: 8_000_000,
        filePrincipal: expect.objectContaining({ userId: 'actor-1' }),
      })
    )
    expect(result).toEqual({
      source: 'INLINE',
      data: Buffer.from('%PDF-synthetic').toString('base64'),
    })
    expect(destroyPdf).toHaveBeenCalledOnce()
  })

  it('rejects opaque secret provenance before touching a file or Oracle object', async () => {
    provenance.mockReturnValue({ success: false, status: 400, error: 'Unsafe model input' })
    await expect(prepareDocumentSource(input(), call)).rejects.toThrow('Unsafe model input')
    expect(authorize).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it.each(['authorization', 'provenance'])(
    'denies %s failures before reading bytes',
    async (kind) => {
      if (kind === 'authorization') authorize.mockRejectedValue(new Error('private detail'))
      else safeKey.mockResolvedValue(false)
      await expect(prepareDocumentSource(input(), call)).rejects.toThrow(
        kind === 'authorization' ? 'File is not available' : 'Unsafe workspace file'
      )
      expect(download).not.toHaveBeenCalled()
    }
  )

  it('rejects unsafe contributing files after authorized materialization', async () => {
    const contributor = { kind: 'workspace_file', fileId: 'contributor-1' }
    download.mockResolvedValue({
      buffer: Buffer.from('%PDF-synthetic'),
      contributingFiles: [contributor],
    })
    safeContributor.mockResolvedValue(false)
    await expect(prepareDocumentSource(input(), call)).rejects.toThrow('Unsafe workspace file')
    expect(safeContributor).toHaveBeenCalledWith('workspace-1', contributor)
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('uses Oracle namespace/bucket/object locations without treating them as Sim files', async () => {
    const objects = [
      {
        namespaceName: 'namespace',
        bucketName: 'bucket',
        objectName: 'exact/a b.pdf',
        pageRange: ['1-3'],
      },
    ]
    const sync = await prepareDocumentSource(
      input({ source: 'objectStorage', file: undefined, objects }),
      call
    )
    expect(sync).toEqual({ source: 'OBJECT_STORAGE', ...objects[0] })
    const batch = await prepareDocumentSource(
      input({
        operation: 'create_processor_job',
        source: 'objectStorage',
        file: undefined,
        objects,
        compartmentId: 'compartment-1',
        outputLocation: { namespaceName: 'namespace', bucketName: 'results', prefix: 'docs' },
      }),
      call
    )
    expect(batch).toEqual({ sourceType: 'OBJECT_STORAGE_LOCATIONS', objectLocations: objects })
    expect(provenance).toHaveBeenCalledTimes(2)
    expect(download).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
  })

  it('rejects URL-only and inline-base64 inputs at the boundary', () => {
    expect(() => input({ file: { url: 'https://example.com/private.pdf' } })).toThrow()
    expect(() => input({ file: { ...file, base64: 'raw-document' } })).toThrow()
    expect(() => input({ file: { ...file, providerFileId: 'file-external' } })).toThrow()
  })

  it('enforces actual byte and page limits rather than trusting file metadata', async () => {
    await expect(validateDocumentBytes(Buffer.alloc(8_000_001))).rejects.toThrow('8,000,000')
    openPdf.mockResolvedValue({ numPages: 6, destroy: destroyPdf })
    await expect(validateDocumentBytes(Buffer.from('%PDF-synthetic'))).rejects.toThrow('five pages')
    expect(destroyPdf).toHaveBeenCalledOnce()
    imageMetadata.mockResolvedValue({ format: 'tiff', pages: 6, width: 100, height: 100 })
    await expect(validateDocumentBytes(Buffer.from('synthetic TIFF'))).rejects.toThrow('five pages')
    imageMetadata.mockResolvedValue({ format: 'png', width: 10001, height: 100 })
    await expect(validateDocumentBytes(Buffer.from('synthetic PNG'))).rejects.toThrow('pixels')
    imageMetadata.mockResolvedValue({ format: 'webp', width: 100, height: 100 })
    await expect(validateDocumentBytes(Buffer.from('synthetic WebP'))).rejects.toThrow('Only JPEG')
  })
})
