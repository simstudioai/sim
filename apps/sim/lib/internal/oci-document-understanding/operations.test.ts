/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestOci, prepareClient, prepareSource, uploadExecution, uploadCopilot } = vi.hoisted(
  () => ({
    requestOci: vi.fn(),
    prepareClient: vi.fn(),
    prepareSource: vi.fn(),
    uploadExecution: vi.fn(),
    uploadCopilot: vi.fn(),
  })
)
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: prepareClient }))
vi.mock('@/lib/internal/oci-document-understanding/document-input', () => ({
  prepareDocumentSource: prepareSource,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: uploadExecution }))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: uploadCopilot }))

import { executeDocumentOperation } from '@/lib/internal/oci-document-understanding/operations'
import { documentInputSchema } from '@/lib/internal/oci-document-understanding/schema'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const job = {
  id: 'job-1',
  compartmentId: 'compartment-1',
  lifecycleState: 'SUCCEEDED',
  timeAccepted: '2026-01-01T00:00:00Z',
  outputLocation: { namespaceName: 'namespace', bucketName: 'results', prefix: 'documents' },
}
const analysis = { documentMetadata: { pageCount: 0, mimeType: 'application/pdf' }, pages: [] }
const context: InternalToolOperationCall = {
  toolId: 'oci_document_understanding_analyze_document',
  headers: new Headers(),
  requestId: 'request-1',
  context: { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' },
}
const object = {
  namespaceName: 'namespace',
  bucketName: 'documents',
  objectName: 'invoices/a b.pdf',
}
const auth = { credentialId: 'authorized-credential', region: 'us-chicago-1' }

function response(body: unknown, headers: Record<string, string> = {}) {
  return {
    status: 200,
    body: new TextEncoder().encode(JSON.stringify(body)),
    headers,
    opcRequestId: 'opc-request-1',
  }
}

function input(operation: string, values: Record<string, unknown> = {}) {
  return documentInputSchema.parse({ ...auth, operation, ...values })
}

describe('OCI document operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareClient.mockResolvedValue({
      request: requestOci,
      prepareStaticEndpoint: vi.fn(async (policy) => policy),
    })
    prepareSource.mockResolvedValue({ source: 'OBJECT_STORAGE', ...object })
    requestOci.mockResolvedValue(response(analysis))
  })

  it('combines analysis features in one paid request without transport retries', async () => {
    const features = [
      { featureType: 'TEXT_EXTRACTION' },
      { featureType: 'TABLE_EXTRACTION' },
      { featureType: 'KEY_VALUE_EXTRACTION', modelId: 'model-1', tenancyId: 'tenancy-1' },
      { featureType: 'DOCUMENT_CLASSIFICATION', maxResults: 3 },
      { featureType: 'LANGUAGE_CLASSIFICATION', maxResults: 2 },
    ]
    const result = await executeDocumentOperation(
      input('analyze_document', {
        source: 'objectStorage',
        objects: [object],
        features,
      }),
      context
    )
    expect(result.success).toBe(true)
    expect(prepareClient).toHaveBeenCalledWith({
      ...auth,
      workspaceId: 'workspace-1',
      serviceId: 'oci_document_understanding',
    })
    expect(requestOci).toHaveBeenCalledTimes(1)
    const call = requestOci.mock.calls[0][0]
    expect(call).toMatchObject({
      method: 'POST',
      encodedPath: '/20221109/actions/analyzeDocument',
      maxResponseBytes: 32 * 1024 * 1024,
    })
    expect(call.retry).toBeUndefined()
    expect(JSON.parse(Buffer.from(call.body).toString())).toEqual({
      features,
      document: { source: 'OBJECT_STORAGE', ...object },
    })
  })

  it('submits searchable PDF jobs with one stable provider token and no ZIP output', async () => {
    prepareSource.mockResolvedValue({
      sourceType: 'OBJECT_STORAGE_LOCATIONS',
      objectLocations: [object],
    })
    requestOci.mockResolvedValue(response(job))
    const result = await executeDocumentOperation(
      input('create_processor_job', {
        source: 'objectStorage',
        objects: [object],
        compartmentId: 'compartment-1',
        features: [{ featureType: 'TEXT_EXTRACTION', generateSearchablePdf: true }],
        outputLocation: job.outputLocation,
        retryToken: 'logical-submission-1',
      }),
      context
    )
    const call = requestOci.mock.calls[0][0]
    expect(call.retry).toEqual({
      kind: 'tokenized',
      maxAttempts: 3,
      retryToken: 'logical-submission-1',
    })
    expect(JSON.parse(Buffer.from(call.body).toString()).processorConfig).toEqual({
      processorType: 'GENERAL',
      isZipOutputEnabled: false,
      features: [{ featureType: 'TEXT_EXTRACTION', generateSearchablePdf: true }],
    })
    expect(result.output.retryToken).toBe('logical-submission-1')
  })

  it('reads a partial job once and makes its ETag available for cancellation', async () => {
    requestOci.mockResolvedValue(
      response(
        { ...job, lifecycleState: 'FAILED', lifecycleDetails: 'PARTIALLY_SUCCEEDED' },
        { etag: 'job-etag' }
      )
    )
    const result = await executeDocumentOperation(
      input('get_processor_job', { jobId: job.id }),
      context
    )
    expect(requestOci).toHaveBeenCalledTimes(1)
    expect(result.output).toMatchObject({
      etag: 'job-etag',
      job: { terminal: true, partiallySucceeded: true },
    })
  })

  it('cancels with a signed empty POST and never invents a terminal response', async () => {
    requestOci.mockResolvedValue({ ...response(null), body: new Uint8Array(0) })
    const result = await executeDocumentOperation(
      input('cancel_processor_job', { jobId: job.id, ifMatch: 'job-etag' }),
      context
    )
    expect(requestOci.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      body: new Uint8Array(0),
      headers: { 'if-match': 'job-etag' },
      encodedPath: '/20221109/processorJobs/job-1/actions/cancel',
    })
    expect(requestOci.mock.calls[0][0].retry).toBeUndefined()
    expect(result.output).toMatchObject({ cancellationRequested: true, jobId: job.id })
    expect(result.output.job).toBeUndefined()
  })

  it('lists one storage page using the canonical job output location', async () => {
    const name = 'documents/job-1/namespace_documents/results/invoices/a b.pdf.json'
    requestOci.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(
      response({
        objects: [{ name, size: 100, etag: 'artifact-etag' }],
        nextStartWith: `${name}.next`,
      })
    )
    const result = await executeDocumentOperation(
      input('list_job_outputs', { jobId: job.id, limit: 1 }),
      context
    )
    expect(result.output.objects).toEqual([{ name, size: 100, etag: 'artifact-etag' }])
    expect(result.output.nextStartWith).toBe(`${name}.next`)
    expect(requestOci.mock.calls[1][0]).toMatchObject({
      method: 'GET',
      encodedPath: '/n/namespace/b/results/o',
      queryPairs: [
        ['prefix', 'documents/job-1/'],
        ['limit', '1'],
        ['fields', 'name,size,etag,timeCreated'],
      ],
    })
    expect(requestOci).toHaveBeenCalledTimes(2)
  })

  it('rejects a foreign artifact before its storage request', async () => {
    requestOci.mockResolvedValue(response(job))
    await expect(
      executeDocumentOperation(
        input('get_job_output', {
          jobId: job.id,
          objectName: 'documents/job-2/results/private.json',
        }),
        context
      )
    ).rejects.toThrow('outside this job')
    expect(requestOci).toHaveBeenCalledTimes(1)
  })

  it('encodes exact artifact names once and persists bounded file bytes before returning', async () => {
    const file = {
      id: 'file-1',
      name: 'document-output.pdf',
      key: 'execution/file-1',
      url: '/files/file-1',
      size: 4,
      type: 'application/pdf',
    }
    const name = 'documents/job-1/_/results/a%2Fb +.pdf'
    requestOci.mockResolvedValueOnce(response(job)).mockResolvedValueOnce({
      ...response(null, { 'content-type': 'application/pdf' }),
      body: new TextEncoder().encode('%PDF'),
    })
    uploadExecution.mockResolvedValue(file)
    const result = await executeDocumentOperation(
      input('get_job_output', {
        jobId: job.id,
        objectName: name,
        resultType: 'file',
        ifMatch: 'artifact-etag',
      }),
      context
    )
    expect(requestOci.mock.calls[1][0]).toMatchObject({
      encodedPath: '/n/namespace/b/results/o/documents%2Fjob-1%2F_%2Fresults%2Fa%252Fb%20%2B.pdf',
      maxResponseBytes: 100 * 1024 * 1024,
      headers: { 'if-match': 'artifact-etag' },
    })
    expect(uploadExecution).toHaveBeenCalledWith(
      context.context,
      Buffer.from('%PDF'),
      'document-output.pdf',
      'application/pdf',
      undefined
    )
    expect(result.output.file).toEqual(file)
    expect(uploadCopilot).not.toHaveBeenCalled()
  })

  it('rejects failed artifact persistence instead of returning an ephemeral Oracle URL', async () => {
    requestOci.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(response(analysis))
    uploadExecution.mockRejectedValue(new Error('storage unavailable'))
    await expect(
      executeDocumentOperation(
        input('get_job_output', {
          jobId: job.id,
          objectName: 'documents/job-1/_/results/defaultObject.json',
          resultType: 'file',
        }),
        context
      )
    ).rejects.toThrow('storage unavailable')
  })

  it('projects a structured artifact without uploading it', async () => {
    requestOci.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(response(analysis))
    const result = await executeDocumentOperation(
      input('get_job_output', {
        jobId: job.id,
        objectName: 'documents/job-1/_/results/defaultObject.json',
      }),
      context
    )
    expect(result.output.analysis?.documentMetadata).toEqual(analysis.documentMetadata)
    expect(uploadExecution).not.toHaveBeenCalled()
  })

  it('preserves discovery cursors and flattens documented model capabilities', async () => {
    requestOci.mockResolvedValueOnce(
      response({ items: [{ id: 'model-1', modelVersion: '2' }] }, { 'opc-next-page': 'cursor-2' })
    )
    const models = await executeDocumentOperation(
      input('list_models', {
        compartmentId: 'compartment-1',
        projectId: 'project-1',
        page: 'cursor-1',
        limit: 1,
      }),
      context
    )
    expect(models.output.nextPage).toBe('cursor-2')
    expect(requestOci.mock.calls[0][0].queryPairs).toContainEqual(['projectId', 'project-1'])
    requestOci.mockResolvedValueOnce(
      response({
        versions: ['2'],
        capabilities: {
          '2': { capability: { language: { details: ['en', 'fr'] } } },
        },
      })
    )
    const capability = await executeDocumentOperation(
      input('get_model_type', { modelType: 'PRE_TRAINED_TEXT_EXTRACTION' }),
      context
    )
    expect(capability.output.capabilities).toEqual([
      { version: '2', name: 'language', details: ['en', 'fr'] },
    ])
  })

  it('rejects invalid combinations and oversized lists before dispatch', () => {
    const base = {
      ...auth,
      source: 'objectStorage',
      objects: [object],
      features: [{ featureType: 'TEXT_EXTRACTION' }],
    }
    for (const patch of [
      { features: [{ featureType: 'TEXT_EXTRACTION', generateSearchablePdf: true }] },
      { objects: [object, object] },
      { features: [{ featureType: 'TEXT_EXTRACTION' }, { featureType: 'TEXT_EXTRACTION' }] },
      { objects: [{ ...object, pageRange: ['1-6'] }] },
      { source: 'https://example.com/document.pdf' },
    ])
      expect(
        documentInputSchema.safeParse({ operation: 'analyze_document', ...base, ...patch }).success
      ).toBe(false)
    expect(
      documentInputSchema.safeParse({
        ...auth,
        operation: 'list_models',
        compartmentId: 'compartment-1',
        limit: 101,
      }).success
    ).toBe(false)
    expect(requestOci).not.toHaveBeenCalled()
  })

  it('rejects a batch over the provider request limit before paid submission', async () => {
    const objects = Array.from({ length: 600 }, (_, index) => ({
      ...object,
      objectName: `${index}-${'x'.repeat(900)}.pdf`,
    }))
    prepareSource.mockResolvedValue({
      sourceType: 'OBJECT_STORAGE_LOCATIONS',
      objectLocations: objects,
    })
    await expect(
      executeDocumentOperation(
        input('create_processor_job', {
          source: 'objectStorage',
          objects,
          compartmentId: 'compartment-1',
          features: [{ featureType: 'TEXT_EXTRACTION' }],
          outputLocation: job.outputLocation,
        }),
        context
      )
    ).rejects.toMatchObject({ status: 413 })
    expect(requestOci).not.toHaveBeenCalled()
  })

  it('does not prepare credentials or dispatch after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeDocumentOperation(input('get_processor_job', { jobId: job.id }), {
        ...context,
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect(prepareClient).not.toHaveBeenCalled()
    expect(requestOci).not.toHaveBeenCalled()
  })
})
