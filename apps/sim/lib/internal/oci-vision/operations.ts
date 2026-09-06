import { resolvePrincipalAttribution, resolvePrincipalSubject } from '@sim/auth/principal'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { createOciClient, type OciAuthenticatedResponse } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { OciVisionOperationError } from '@/lib/internal/oci-vision/errors'
import { readOciVisionImage } from '@/lib/internal/oci-vision/image-input'
import {
  normalizeVisionAnalysis,
  normalizeVisionCursor,
  normalizeVisionJob,
  normalizeVisionModel,
  normalizeVisionOutputObject,
  normalizeVisionProject,
  visionArray,
  visionRecord,
} from '@/lib/internal/oci-vision/normalizers'
import type { OciVisionFeatureInput, OciVisionInput } from '@/lib/internal/oci-vision/schema'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import {
  OCI_VISION_MAX_BATCH_BYTES,
  OCI_VISION_MAX_DOWNLOAD_BYTES,
  OCI_VISION_MAX_JSON_BYTES,
  OCI_VISION_REGIONS,
} from '@/tools/oci_vision/shared'
import type { OciVisionResponse } from '@/tools/oci_vision/types'

const visionPolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_vision',
  serviceName: 'vision.aiservice',
  hostnameTemplate: 'regional-oci',
})
const visionRegionalPolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_vision',
  serviceName: 'vision.aiservice',
  hostnameTemplate: 'regional',
})
const storagePolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_vision',
  serviceName: 'objectstorage',
  hostnameTemplate: 'regional',
})
const API_PATH = '/20220125'
const REQUEST_TIMEOUT_MS = 60_000

export interface OciVisionOperationContext extends InternalToolOperationContext {
  workspaceId: string
  headers: Headers
  requestId: string
  signal?: AbortSignal
}

/** Binds only an executor/selector-authorized credential and a trusted workspace. */
export async function prepareOciVisionClient(
  input: { credentialId: string; region?: string },
  workspaceId: string
) {
  if (!workspaceId) throw new OciVisionOperationError('Workspace context is required', 403)
  const client = await createOciClient({
    credentialId: input.credentialId,
    ...(input.region ? { region: input.region } : {}),
    workspaceId,
    serviceId: 'oci_vision',
  })
  let endpoint = await client.prepareStaticEndpoint(visionPolicy)
  if (!OCI_VISION_REGIONS.some((region) => region === endpoint.region.id)) {
    throw new OciVisionOperationError('Vision is not configured for this region')
  }
  if (['ap-hyderabad-1', 'ap-kulai-2'].includes(endpoint.region.id)) {
    endpoint = await client.prepareStaticEndpoint(visionRegionalPolicy)
  }
  return { client, endpoint }
}

/** OCI requires complete path parameters to be encoded once, including embedded slashes. */
export function encodeOciVisionPathValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function json(response: OciAuthenticatedResponse): unknown {
  try {
    return JSON.parse(Buffer.from(response.body).toString('utf8'))
  } catch {
    throw new OciVisionOperationError('OCI returned an invalid JSON response', 502)
  }
}

export function buildOciVisionFeatures(input: OciVisionFeatureInput) {
  return input.features.map((featureType) => {
    switch (featureType) {
      case 'IMAGE_CLASSIFICATION':
        return {
          featureType,
          maxResults: input.classificationMaxResults ?? 5,
          ...(input.classificationModelId ? { modelId: input.classificationModelId } : {}),
        }
      case 'OBJECT_DETECTION':
        return {
          featureType,
          maxResults: input.objectDetectionMaxResults ?? 5,
          ...(input.objectDetectionModelId ? { modelId: input.objectDetectionModelId } : {}),
        }
      case 'TEXT_DETECTION':
        return { featureType, ...(input.language ? { language: input.language } : {}) }
      case 'FACE_DETECTION':
        return {
          featureType,
          maxResults: input.faceMaxResults ?? 50,
          shouldReturnLandmarks: input.shouldReturnLandmarks ?? false,
        }
    }
  })
}

export async function executeOciVisionOperation(
  input: OciVisionInput,
  context: OciVisionOperationContext,
  prepared?: Awaited<ReturnType<typeof prepareOciVisionClient>>
): Promise<OciVisionResponse> {
  const { signal } = context
  signal?.throwIfAborted()
  if (input.operation === 'analyze_image') {
    const provenance = validateOpaqueModelInputProvenance({
      headers: context.headers,
      payload: input,
      isInternalRequest: true,
    })
    if (!provenance.success) throw new OciVisionOperationError(provenance.error, provenance.status)
  }
  const { client, endpoint } =
    prepared ?? (await prepareOciVisionClient(input, context.workspaceId))
  const deadlineSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal
  const read = (path: string, queryPairs: [string, string][] = []) =>
    client.request({
      endpoint,
      method: 'GET',
      encodedPath: `${API_PATH}${path}`,
      queryPairs,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: OCI_VISION_MAX_JSON_BYTES,
      responseHeaders: ['opc-next-page', 'etag'],
      retry: { kind: 'safe', maxAttempts: 3 },
      signal: requestSignal,
    })
  const send = (path: string, body: unknown, retryToken?: string) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    assertKnownSizeWithinLimit(
      bytes.length,
      path === '/imageJobs' ? OCI_VISION_MAX_BATCH_BYTES : OCI_VISION_MAX_JSON_BYTES,
      'OCI Vision request'
    )
    return client.request({
      endpoint,
      method: 'POST',
      encodedPath: `${API_PATH}${path}`,
      body: new Uint8Array(bytes),
      contentType: 'application/json',
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: OCI_VISION_MAX_JSON_BYTES,
      signal: requestSignal,
      ...(retryToken ? { retry: { kind: 'tokenized' as const, maxAttempts: 2, retryToken } } : {}),
    })
  }
  const result = <T extends object>(response: OciAuthenticatedResponse, output: T) => ({
    success: true,
    output: { ...output, opcRequestId: response.opcRequestId ?? null },
  })

  if (input.operation === 'analyze_image' || input.operation === 'create_image_job') {
    for (const [modelId, modelType] of [
      [input.classificationModelId, 'IMAGE_CLASSIFICATION'],
      [input.objectDetectionModelId, 'OBJECT_DETECTION'],
    ] as const) {
      if (!modelId) continue
      const modelResponse = await read(`/models/${encodeOciVisionPathValue(modelId)}`)
      const model = normalizeVisionModel(json(modelResponse))
      if (
        model.id !== modelId ||
        model.modelType !== modelType ||
        model.lifecycleState !== 'ACTIVE'
      ) {
        throw new OciVisionOperationError(
          'Custom model must be ACTIVE and match its selected feature'
        )
      }
    }
  }

  switch (input.operation) {
    case 'analyze_image': {
      const image =
        input.source === 'file'
          ? {
              source: 'INLINE',
              data: (await readOciVisionImage(input.file!, context, requestSignal)).toString(
                'base64'
              ),
            }
          : {
              source: 'OBJECT_STORAGE',
              namespaceName: input.namespaceName,
              bucketName: input.bucketName,
              objectName: input.objectName,
            }
      const response = await send('/actions/analyzeImage', {
        image,
        features: buildOciVisionFeatures(input),
        ...(input.compartmentId ? { compartmentId: input.compartmentId } : {}),
      })
      return {
        success: true,
        output: {
          ...normalizeVisionAnalysis(json(response)),
          opcRequestId: response.opcRequestId ?? null,
        },
      }
    }
    case 'create_image_job': {
      const response = await send(
        '/imageJobs',
        {
          features: buildOciVisionFeatures(input),
          inputLocation: {
            sourceType: 'OBJECT_LIST_INLINE_INPUT_LOCATION',
            objectLocations: input.objectLocations,
          },
          outputLocation: {
            namespaceName: input.outputNamespaceName,
            bucketName: input.outputBucketName,
            prefix: input.outputPrefix,
          },
          ...(input.compartmentId ? { compartmentId: input.compartmentId } : {}),
          ...(input.displayName ? { displayName: input.displayName } : {}),
          isZipOutputEnabled: input.isZipOutputEnabled ?? false,
        },
        input.retryToken
      )
      return result(response, { job: normalizeVisionJob(json(response)) })
    }
    case 'get_image_job': {
      const response = await read(`/imageJobs/${encodeOciVisionPathValue(input.imageJobId)}`)
      return result(response, {
        job: normalizeVisionJob(json(response)),
        etag: response.headers.etag ?? null,
      })
    }
    case 'cancel_image_job': {
      const response = await client.request({
        endpoint,
        method: 'POST',
        encodedPath: `${API_PATH}/imageJobs/${encodeOciVisionPathValue(input.imageJobId)}/actions/cancel`,
        body: new Uint8Array(0),
        contentType: 'application/json',
        headers: input.ifMatch ? { 'if-match': input.ifMatch } : {},
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes: 4096,
        signal: requestSignal,
      })
      if (response.status !== 202) {
        throw new OciVisionOperationError('Unexpected cancellation response', 502)
      }
      return result(response, { imageJobId: input.imageJobId, cancellationRequested: true })
    }
    case 'list_projects':
    case 'list_models': {
      const query: [string, string][] = [
        ['compartmentId', input.compartmentId],
        ['limit', String(input.limit)],
      ]
      for (const key of [
        'page',
        'displayName',
        'lifecycleState',
        'id',
        'sortBy',
        'sortOrder',
      ] as const) {
        if (input[key] !== undefined) query.push([key, input[key]])
      }
      if (input.operation === 'list_models' && input.projectId) {
        query.push(['projectId', input.projectId])
      }
      const response = await read(
        input.operation === 'list_models' ? '/models' : '/projects',
        query
      )
      const items = visionArray(visionRecord(json(response)).items)
      if (items.length > input.limit) {
        throw new OciVisionOperationError('OCI returned too many list items', 502)
      }
      const nextPage = normalizeVisionCursor(response.headers['opc-next-page'])
      return input.operation === 'list_models'
        ? result(response, { models: items.map(normalizeVisionModel), nextPage })
        : result(response, { projects: items.map(normalizeVisionProject), nextPage })
    }
    case 'get_project': {
      const response = await read(`/projects/${encodeOciVisionPathValue(input.projectId)}`)
      return result(response, { project: normalizeVisionProject(json(response)) })
    }
    case 'get_model': {
      const response = await read(`/models/${encodeOciVisionPathValue(input.modelId)}`)
      return result(response, { model: normalizeVisionModel(json(response)) })
    }
    case 'list_image_job_outputs':
    case 'download_image_job_output': {
      const response = await read(`/imageJobs/${encodeOciVisionPathValue(input.imageJobId)}`)
      const job = normalizeVisionJob(json(response))
      const location = job.outputLocation
      if (job.id !== input.imageJobId || !location.prefix) {
        throw new OciVisionOperationError(
          'Output access requires a matching job with a nonempty output prefix'
        )
      }
      const storageEndpoint = await client.prepareStaticEndpoint(storagePolicy)
      const path = `/n/${encodeOciVisionPathValue(location.namespaceName)}/b/${encodeOciVisionPathValue(location.bucketName)}/o`
      const common = {
        endpoint: storageEndpoint,
        method: 'GET' as const,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal: requestSignal,
        retry: { kind: 'safe' as const, maxAttempts: 3 },
      }
      if (input.operation === 'list_image_job_outputs') {
        const queryPairs: [string, string][] = [
          ['prefix', location.prefix],
          ['limit', String(input.limit)],
          ['fields', 'name,size,etag,timeModified'],
        ]
        if (input.start) queryPairs.push(['start', input.start])
        const listed = await client.request({
          ...common,
          encodedPath: path,
          queryPairs,
          maxResponseBytes: OCI_VISION_MAX_JSON_BYTES,
        })
        const body = visionRecord(json(listed))
        const objects = visionArray(body.objects)
        if (objects.length > input.limit) {
          throw new OciVisionOperationError('OCI returned too many output objects', 502)
        }
        const selected = objects.map(normalizeVisionOutputObject)
        if (selected.some((object) => !object.name.startsWith(location.prefix))) {
          throw new OciVisionOperationError('OCI returned an object outside the output prefix', 502)
        }
        return result(listed, {
          imageJobId: job.id,
          outputLocation: location,
          objects: selected,
          nextStartWith: normalizeVisionCursor(body.nextStartWith),
        })
      }
      if (!input.objectName.startsWith(location.prefix)) {
        throw new OciVisionOperationError('Object name must be under the job output prefix')
      }
      if (!context.executorDelegationOrigin) {
        throw new OciVisionOperationError(
          'Trusted execution context is required for file output',
          403
        )
      }
      const principal = await createExecutorPrincipalFromExecutionContext({
        context,
        audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      })
      const { attributedUserId } = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billingAttribution?.billedAccountUserId,
      })
      const subject = resolvePrincipalSubject(principal)
      if (!context.executionId && (subject?.kind !== 'sim_user' || !context.copilotToolExecution)) {
        throw new OciVisionOperationError(
          'File output requires an execution or authenticated Copilot context',
          403
        )
      }
      const downloaded = await client.request({
        ...common,
        encodedPath: `${path}/${encodeOciVisionPathValue(input.objectName)}`,
        headers: input.ifMatch ? { 'if-match': input.ifMatch } : {},
        maxResponseBytes: OCI_VISION_MAX_DOWNLOAD_BYTES,
        responseHeaders: ['content-type', 'content-length', 'etag'],
      })
      requestSignal.throwIfAborted()
      assertKnownSizeWithinLimit(
        downloaded.body.byteLength,
        OCI_VISION_MAX_DOWNLOAD_BYTES,
        'job output file'
      )
      const contentType = downloaded.headers['content-type'] ?? 'application/octet-stream'
      const buffer = Buffer.from(downloaded.body)
      const fileName = input.objectName.split('/').pop() || 'vision-output'
      const file = context.executionId
        ? await uploadExecutionFile(
            {
              workspaceId: context.workspaceId,
              workflowId: context.workflowId,
              executionId: context.executionId,
            },
            buffer,
            fileName,
            contentType,
            attributedUserId
          )
        : await uploadCopilotFile({ buffer, fileName, contentType, userId: attributedUserId })
      requestSignal.throwIfAborted()
      return result(downloaded, {
        imageJobId: job.id,
        objectName: input.objectName,
        etag: downloaded.headers.etag ?? null,
        contentType,
        size: buffer.length,
        file,
      })
    }
  }
}
