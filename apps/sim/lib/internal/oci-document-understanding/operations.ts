import { generateId } from '@sim/utils/id'
import type { OciAuthenticatedResponse } from '@/lib/internal/oci/client.server'
import {
  documentJsonBody,
  documentPath,
  type PreparedDocumentClient,
  parseDocumentJson,
  prepareDocumentClient,
} from '@/lib/internal/oci-document-understanding/client'
import { prepareDocumentSource } from '@/lib/internal/oci-document-understanding/document-input'
import { DocumentOperationError } from '@/lib/internal/oci-document-understanding/errors'
import {
  documentCursor,
  documentRecord,
  normalizeDocumentAnalysis,
  normalizeDocumentJob,
  normalizeDocumentModel,
} from '@/lib/internal/oci-document-understanding/normalizers'
import {
  DOCUMENT_JSON_BYTES,
  type DocumentInput,
} from '@/lib/internal/oci-document-understanding/schema'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { DocumentJob, OciDocumentResponse } from '@/tools/oci_document_understanding/types'

const API = '/20221109'

export interface DocumentOperationRequest extends InternalToolOperationCall {
  onMutationDispatch?: (retryToken?: string) => void
}

export function jobOutputPrefix(job: DocumentJob) {
  /** Oracle's SDK workshop names artifacts as <configured prefix>/<job OCID>/… . */
  return `${job.outputLocation.prefix}/${job.id}/`
}

export async function executeDocumentOperation(
  input: DocumentInput,
  request: DocumentOperationRequest,
  prepared?: PreparedDocumentClient
): Promise<OciDocumentResponse> {
  const signal = AbortSignal.any([
    ...(request.signal ? [request.signal] : []),
    AbortSignal.timeout(300_000),
  ])
  signal.throwIfAborted()
  const destination = prepared ?? (await prepareDocumentClient(input, request.context.workspaceId!))
  const { client, endpoint, storage } = destination
  const common = {
    signal,
    timeoutMs: 120_000,
    maxResponseBytes: DOCUMENT_JSON_BYTES,
    responseHeaders: ['opc-next-page', 'etag', 'content-length'],
  }
  const result = (
    response: OciAuthenticatedResponse,
    output: OciDocumentResponse['output']
  ): OciDocumentResponse => ({
    success: true,
    output: { ...output, opcRequestId: response.opcRequestId },
  })
  const get = (encodedPath: string, query: Record<string, string | number | undefined> = {}) =>
    client.request({
      ...common,
      endpoint,
      method: 'GET',
      encodedPath,
      queryPairs: Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)] as const),
      retry: { kind: 'safe', maxAttempts: 3 },
    })
  const getJob = async (id: string) => {
    const response = await get(`${API}/processorJobs/${documentPath(id)}`)
    const job = normalizeDocumentJob(parseDocumentJson(response))
    if (job.id !== id) throw new DocumentOperationError('Processor job identity mismatch', 502)
    return { response, job }
  }

  switch (input.operation) {
    case 'analyze_document':
    case 'create_processor_job': {
      const document = await prepareDocumentSource(input, { ...request, signal })
      const settings = {
        features: input.features,
        documentType: input.documentType,
        language: input.language,
      }
      const body =
        input.operation === 'analyze_document'
          ? { ...settings, compartmentId: input.compartmentId, document }
          : {
              compartmentId: input.compartmentId,
              displayName: input.displayName,
              inputLocation: document,
              outputLocation: input.outputLocation,
              processorConfig: { processorType: 'GENERAL', ...settings, isZipOutputEnabled: false },
            }
      const bytes = documentJsonBody(
        body,
        input.operation === 'create_processor_job' && input.source === 'objectStorage'
          ? 500_000
          : 12_000_000
      )
      const retryToken =
        input.operation === 'create_processor_job' ? (input.retryToken ?? generateId()) : undefined
      signal.throwIfAborted()
      request.onMutationDispatch?.(retryToken)
      const response = await client.request({
        ...common,
        endpoint,
        method: 'POST',
        encodedPath:
          input.operation === 'analyze_document'
            ? `${API}/actions/analyzeDocument`
            : `${API}/processorJobs`,
        contentType: 'application/json',
        body: bytes,
        ...(retryToken
          ? { retry: { kind: 'tokenized' as const, maxAttempts: 3, retryToken } }
          : {}),
      })
      signal.throwIfAborted()
      return input.operation === 'analyze_document'
        ? result(response, {
            analysis: normalizeDocumentAnalysis(parseDocumentJson(response), input),
          })
        : result(response, { job: normalizeDocumentJob(parseDocumentJson(response)), retryToken })
    }
    case 'get_processor_job': {
      const { response, job } = await getJob(input.jobId)
      return result(response, { job, etag: response.headers.etag })
    }
    case 'cancel_processor_job': {
      request.onMutationDispatch?.()
      const response = await client.request({
        ...common,
        endpoint,
        method: 'POST',
        encodedPath: `${API}/processorJobs/${documentPath(input.jobId)}/actions/cancel`,
        body: new Uint8Array(0),
        contentType: 'application/json',
        headers: input.ifMatch ? { 'if-match': input.ifMatch } : undefined,
      })
      return result(response, { jobId: input.jobId, cancellationRequested: true })
    }
    case 'list_job_outputs':
    case 'get_job_output': {
      const { job } = await getJob(input.jobId)
      const prefix = jobOutputPrefix(job)
      const bucketPath = `/n/${documentPath(job.outputLocation.namespaceName)}/b/${documentPath(job.outputLocation.bucketName)}/o`
      if (input.operation === 'list_job_outputs') {
        if (input.start && !input.start.startsWith(prefix)) {
          throw new DocumentOperationError('Continuation is outside this job’s output prefix')
        }
        const response = await client.request({
          ...common,
          endpoint: storage,
          method: 'GET',
          encodedPath: bucketPath,
          queryPairs: [
            ['prefix', prefix],
            ['limit', String(input.limit)],
            ['fields', 'name,size,etag,timeCreated'],
            ...(input.start ? [['start', input.start] as const] : []),
          ],
          retry: { kind: 'safe', maxAttempts: 3 },
        })
        const data = documentRecord(parseDocumentJson(response))
        if (!Array.isArray(data.objects) || data.objects.length > input.limit) {
          throw new DocumentOperationError('Unexpected job artifact listing', 502)
        }
        const objects = data.objects.map((value) => {
          const object = documentRecord(value)
          if (
            typeof object.name !== 'string' ||
            object.name.length > 1024 ||
            !object.name.startsWith(prefix)
          ) {
            throw new DocumentOperationError('Unexpected job artifact name', 502)
          }
          if (
            object.size != null &&
            (typeof object.size !== 'number' || !Number.isFinite(object.size) || object.size < 0)
          ) {
            throw new DocumentOperationError('Unexpected artifact size', 502)
          }
          return {
            name: object.name,
            size: typeof object.size === 'number' ? object.size : undefined,
            etag: object.etag == null ? undefined : (documentCursor(object.etag) ?? undefined),
            timeCreated:
              object.timeCreated == null
                ? undefined
                : (documentCursor(object.timeCreated) ?? undefined),
          }
        })
        const next = documentCursor(data.nextStartWith)
        if (next && !next.startsWith(prefix)) {
          throw new DocumentOperationError('Unexpected job artifact continuation', 502)
        }
        return result(response, { job, objects, nextStartWith: next })
      }
      if (!input.objectName.startsWith(prefix) || input.objectName.length <= prefix.length) {
        throw new DocumentOperationError('Artifact is outside this job’s output prefix')
      }
      const { workspaceId, workflowId, executionId } = request.context
      const userId =
        request.context.executorDelegationOrigin?.subjectUserId ??
        (request.context.copilotToolExecution ? request.context.userId : undefined)
      if (input.resultType === 'file' && !(workspaceId && workflowId && executionId) && !userId) {
        throw new DocumentOperationError(
          'File output requires execution storage or an authenticated Copilot user',
          403
        )
      }
      const response = await client.request({
        ...common,
        endpoint: storage,
        method: 'GET',
        encodedPath: `${bucketPath}/${documentPath(input.objectName)}`,
        maxResponseBytes:
          input.resultType === 'file' ? MAX_BUFFERED_TRANSFER_BYTES : DOCUMENT_JSON_BYTES,
        headers: input.ifMatch ? { 'if-match': input.ifMatch } : undefined,
        retry: { kind: 'safe', maxAttempts: 3 },
      })
      signal.throwIfAborted()
      if (input.resultType === 'structured') {
        return result(response, {
          jobId: job.id,
          analysis: normalizeDocumentAnalysis(parseDocumentJson(response), input),
        })
      }
      const contentType = response.headers['content-type'] ?? 'application/octet-stream'
      const fileName = contentType.includes('pdf')
        ? 'document-output.pdf'
        : contentType.includes('json')
          ? 'document-output.json'
          : 'document-output.bin'
      const buffer = Buffer.from(response.body)
      const file =
        workspaceId && workflowId && executionId
          ? await uploadExecutionFile(
              { workspaceId, workflowId, executionId },
              buffer,
              fileName,
              contentType,
              userId
            )
          : await uploadCopilotFile({ buffer, fileName, contentType, userId: userId! })
      return result(response, { jobId: job.id, file })
    }
    case 'list_projects':
    case 'list_models': {
      const response = await get(
        `${API}/${input.operation === 'list_projects' ? 'projects' : 'models'}`,
        {
          compartmentId: input.compartmentId,
          displayName: input.displayName,
          lifecycleState: input.lifecycleState,
          limit: input.limit,
          page: input.page,
          projectId: input.operation === 'list_models' ? input.projectId : undefined,
        }
      )
      const data = documentRecord(parseDocumentJson(response))
      if (!Array.isArray(data.items) || data.items.length > input.limit) {
        throw new DocumentOperationError('Unexpected discovery response', 502)
      }
      const values = data.items.map(normalizeDocumentModel)
      return result(response, {
        ...(input.operation === 'list_models' ? { models: values } : { projects: values }),
        nextPage: documentCursor(response.headers['opc-next-page']),
      })
    }
    case 'get_model': {
      const response = await get(`${API}/models/${documentPath(input.modelId)}`)
      return result(response, { model: normalizeDocumentModel(parseDocumentJson(response)) })
    }
    case 'get_model_type': {
      const response = await get(`${API}/modelTypes/${documentPath(input.modelType)}`, {
        compartmentId: input.compartmentId,
        modelSubType: input.modelSubType,
      })
      const data = documentRecord(parseDocumentJson(response))
      const versions = data.versions ?? []
      if (
        !Array.isArray(versions) ||
        versions.length > 100 ||
        versions.some((v) => typeof v !== 'string' || v.length > 256)
      ) {
        throw new DocumentOperationError('Unexpected model versions', 502)
      }
      const capabilities: { version: string; name: string; details: string[] }[] = []
      for (const [version, value] of Object.entries(documentRecord(data.capabilities ?? {}))) {
        if (version.length > 256) {
          throw new DocumentOperationError('Unexpected model version', 502)
        }
        for (const [name, entry] of Object.entries(
          documentRecord(documentRecord(value).capability ?? {})
        )) {
          const details = documentRecord(entry).details
          if (
            capabilities.length >= 100 ||
            name.length > 256 ||
            !Array.isArray(details) ||
            details.length > 100 ||
            details.some((d) => typeof d !== 'string' || d.length > 4096)
          ) {
            throw new DocumentOperationError('Model capabilities exceed their bounds', 502)
          }
          capabilities.push({ version, name, details })
        }
      }
      return result(response, { versions, capabilities })
    }
  }
}
