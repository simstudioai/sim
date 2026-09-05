import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import {
  createOciClient,
  type OciAuthenticatedResponse,
  type OciRequestMethod,
} from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { OciNativeOperationError } from '@/lib/internal/oci-object-storage-native/errors'
import type { OciNativeInput } from '@/lib/internal/oci-object-storage-native/schema'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  isOciNativeJsonWithinLimit,
  OCI_NATIVE_JSON_BYTES,
} from '@/tools/oci_object_storage_native/shared'

const logger = createLogger('OciObjectStorageNativeOperations')
const endpointPolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_object_storage_native',
  serviceName: 'objectstorage',
  hostnameTemplate: 'regional',
})
const RESPONSE_HEADERS = [
  'etag',
  'content-length',
  'content-type',
  'last-modified',
  'version-id',
  'is-delete-marker',
  'opc-content-md5',
  'opc-multipart-md5',
  'content-md5',
  'content-encoding',
  'content-language',
  'content-disposition',
  'cache-control',
  'storage-tier',
  'archival-state',
  'time-of-archival',
  'opc-next-page',
  'opc-work-request-id',
  'retry-after',
  'opc-meta-*',
] as const
const BUCKET_FIELDS = [
  'namespace',
  'name',
  'compartmentId',
  'createdBy',
  'timeCreated',
  'etag',
  'metadata',
  'freeformTags',
  'definedTags',
  'storageTier',
  'versioning',
  'autoTiering',
  'objectEventsEnabled',
  'approximateCount',
  'approximateSize',
  'isReadOnly',
  'publicAccessType',
  'objectLifecyclePolicyEtag',
] as const
const OBJECT_FIELDS = [
  'name',
  'size',
  'etag',
  'md5',
  'timeCreated',
  'timeModified',
  'storageTier',
  'archivalState',
] as const
const UPLOAD_FIELDS = [
  'namespace',
  'bucket',
  'object',
  'uploadId',
  'timeCreated',
  'storageTier',
] as const
const PAR_FIELDS = [
  'id',
  'name',
  'accessType',
  'objectName',
  'timeExpires',
  'timeCreated',
  'bucketListingAction',
] as const
const BUCKET_SETTINGS = [
  'metadata',
  'freeformTags',
  'definedTags',
  'autoTiering',
  'objectEventsEnabled',
  'versioning',
] as const
const CONTENT_SETTINGS = [
  'contentType',
  'contentLanguage',
  'contentEncoding',
  'contentDisposition',
  'cacheControl',
  'storageTier',
] as const

export interface OciNativeOperationContext {
  workspaceId: string
  requestId: string
  userId?: string
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
}

/** The caller supplies the executor/selector-authorized credential ID and trusted workspace. */
export async function prepareOciNativeClient(
  input: { credentialId: string; region?: string },
  workspaceId: string
) {
  if (!workspaceId) throw new OciNativeOperationError('Workspace context is required', 403)
  const client = await createOciClient({
    ...input,
    workspaceId,
    serviceId: 'oci_object_storage_native',
  })
  return { client, endpoint: await client.prepareStaticEndpoint(endpointPolicy) }
}

/** OCI encodes the complete path parameter, including embedded slashes, exactly once. */
export function encodeOciNativePathValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function select(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
  )
}

function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new OciNativeOperationError('Unexpected OCI response shape', 502)
  return value
}

function json(response: OciAuthenticatedResponse): unknown {
  try {
    return JSON.parse(Buffer.from(response.body).toString('utf8'))
  } catch {
    throw new OciNativeOperationError('Unexpected OCI JSON response', 502)
  }
}

function items(
  value: unknown,
  fields: readonly string[],
  limit = 1_000
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new OciNativeOperationError('Unexpected OCI list response', 502)
  return value.map((item) => select(record(item), fields))
}

function token(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 4_096)
    throw new OciNativeOperationError('Unexpected OCI continuation token', 502)
  return value || null
}

function jsonBody(value: Record<string, unknown>): Uint8Array {
  if (!isOciNativeJsonWithinLimit(value, OCI_NATIVE_JSON_BYTES))
    throw new OciNativeOperationError('JSON request exceeds 8 MiB', 413)
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > OCI_NATIVE_JSON_BYTES)
    throw new OciNativeOperationError('JSON request exceeds 8 MiB', 413)
  return new Uint8Array(Buffer.from(serialized, 'utf8'))
}

function metadata(value: Record<string, string> | undefined): Record<string, string> | undefined {
  return value === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(value).map(([key, content]) => [`opc-meta-${key}`, content])
      )
}

function conditions(input: { ifMatch?: string; ifNoneMatch?: string }): Record<string, string> {
  return {
    ...(input.ifMatch ? { 'if-match': input.ifMatch } : {}),
    ...(input.ifNoneMatch ? { 'if-none-match': input.ifNoneMatch } : {}),
  }
}

function objectHeaders(response: OciAuthenticatedResponse): Record<string, unknown> {
  const h = response.headers
  const mappings = {
    etag: 'etag',
    contentType: 'content-type',
    lastModified: 'last-modified',
    versionId: 'version-id',
    contentMd5: 'content-md5',
    opcContentMd5: 'opc-content-md5',
    multipartMd5: 'opc-multipart-md5',
    contentEncoding: 'content-encoding',
    contentLanguage: 'content-language',
    contentDisposition: 'content-disposition',
    cacheControl: 'cache-control',
    storageTier: 'storage-tier',
    archivalState: 'archival-state',
    timeOfArchival: 'time-of-archival',
  }
  return {
    ...Object.fromEntries(
      Object.entries(mappings).map(([key, header]) => [key, h[header] ?? null])
    ),
    contentLength: h['content-length'] === undefined ? null : Number(h['content-length']),
    isDeleteMarker: h['is-delete-marker'] === undefined ? null : h['is-delete-marker'] === 'true',
    metadata: Object.fromEntries(
      Object.entries(h)
        .filter(([key]) => key.startsWith('opc-meta-'))
        .map(([key, value]) => [key.slice(9), value])
    ),
  }
}

async function uploadBody(
  input: Extract<OciNativeInput, { operation: 'upload_object' | 'upload_part' }>,
  context: OciNativeOperationContext
) {
  context.signal?.throwIfAborted()
  if (input.file != null) {
    const file = processSingleFileToUserFile(input.file, context.requestId, logger)
    if (!file) throw new OciNativeOperationError('A valid uploaded file is required')
    if (
      !context.userId ||
      (await assertToolFileAccess(file.key, context.userId, context.requestId, logger))
    ) {
      throw new OciNativeOperationError('File not found or access denied', 404)
    }
    assertKnownSizeWithinLimit(file.size, MAX_BUFFERED_TRANSFER_BYTES, 'OCI upload')
    try {
      const resolved = await downloadServableFileFromStorage(file, context.requestId, logger, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal: context.signal,
      })
      assertKnownSizeWithinLimit(resolved.buffer.length, MAX_BUFFERED_TRANSFER_BYTES, 'OCI upload')
      return {
        body: new Uint8Array(resolved.buffer),
        contentType: input.contentType ?? resolved.contentType,
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) throw new OciNativeOperationError(docNotReadyMessage(), 409)
      throw error
    }
  }
  const content = input.content ?? ''
  assertKnownSizeWithinLimit(
    Buffer.byteLength(content, 'utf8'),
    MAX_BUFFERED_TRANSFER_BYTES,
    'OCI inline upload'
  )
  return {
    body: new Uint8Array(Buffer.from(content, 'utf8')),
    contentType: input.contentType ?? 'text/plain; charset=utf-8',
  }
}

/** One bounded native operation; selectors reuse the same listing contracts and prepared client. */
export async function executeOciNativeOperation(
  input: OciNativeInput,
  context: OciNativeOperationContext,
  prepared?: Awaited<ReturnType<typeof prepareOciNativeClient>>
): Promise<{ success: true; output: Record<string, unknown> }> {
  const transfer = ['upload_object', 'download_object', 'upload_part'].includes(input.operation)
  const timeout = transfer ? 120_000 : 30_000
  const deadlineAt = Date.now() + timeout
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new OciNativeOperationError('OCI operation deadline exceeded', 504)),
    timeout
  )
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal
  try {
    signal.throwIfAborted()
    const { client, endpoint } =
      prepared ??
      (await prepareOciNativeClient(
        { credentialId: input.credentialId, region: input.region },
        context.workspaceId
      ))
    const call = async (
      method: OciRequestMethod,
      path: string,
      options: {
        query?: Record<string, unknown>
        headers?: Record<string, string>
        body?: Record<string, unknown>
        bytes?: Uint8Array
        contentType?: string
        download?: boolean
      } = {}
    ) => {
      signal.throwIfAborted()
      const common = {
        endpoint,
        encodedPath: path,
        signal,
        timeoutMs: Math.max(1, deadlineAt - Date.now()),
        maxResponseBytes: options.download ? MAX_BUFFERED_TRANSFER_BYTES : OCI_NATIVE_JSON_BYTES,
        responseHeaders: RESPONSE_HEADERS,
        headers: options.headers,
        queryPairs: Object.entries(options.query ?? {})
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)] as const),
      }
      if (method === 'GET' || method === 'HEAD')
        return client.request({ ...common, method, retry: { kind: 'safe', maxAttempts: 3 } })
      if (method === 'DELETE') return client.request({ ...common, method })
      return client.request({
        ...common,
        method,
        body: options.bytes ?? jsonBody(options.body ?? {}),
        contentType: options.contentType ?? 'application/json',
      })
    }
    const result = (response: OciAuthenticatedResponse, output: Record<string, unknown>) => ({
      success: true as const,
      output: { ...output, requestId: response.opcRequestId ?? null },
    })
    if (input.operation === 'get_namespace') {
      const response = await call('GET', '/n/', { query: { compartmentId: input.compartmentId } })
      const namespace = json(response)
      if (typeof namespace !== 'string' || !namespace)
        throw new OciNativeOperationError('Unexpected namespace response', 502)
      return result(response, { namespace })
    }
    if (input.operation === 'get_work_request') {
      const response = await call(
        'GET',
        `/workRequests/${encodeOciNativePathValue(input.workRequestId)}`
      )
      const data = record(json(response))
      return result(response, {
        workRequest: select(data, [
          'id',
          'compartmentId',
          'operationType',
          'status',
          'percentComplete',
          'timeAccepted',
          'timeStarted',
          'timeFinished',
        ]),
        resources: items(data.resources ?? [], [
          'entityType',
          'actionType',
          'entityUri',
          'identifier',
        ]),
        retryAfter: response.headers['retry-after'] ?? null,
      })
    }
    let namespace = input.namespace
    if (!namespace) {
      const response = await call('GET', '/n/')
      const value = json(response)
      if (typeof value !== 'string' || !value || value === '.' || value === '..')
        throw new OciNativeOperationError('Unexpected namespace response', 502)
      namespace = value
    }
    const collection = `/n/${encodeOciNativePathValue(namespace)}/b/`
    if (input.operation === 'list_buckets') {
      const response = await call('GET', collection, {
        query: {
          compartmentId: input.compartmentId,
          limit: input.limit,
          page: input.page,
          fields: 'tags',
        },
      })
      return result(response, {
        namespace,
        buckets: items(json(response), BUCKET_FIELDS, input.limit),
        nextPage: token(response.headers['opc-next-page']),
      })
    }
    const bucketPath = `${collection}${encodeOciNativePathValue(input.bucketName)}`
    const identity = { namespace, bucketName: input.bucketName }
    switch (input.operation) {
      case 'create_bucket': {
        const response = await call('POST', collection, {
          body: {
            name: input.bucketName,
            compartmentId: input.compartmentId,
            publicAccessType: 'NoPublicAccess',
            storageTier: input.storageTier,
            ...select(input, BUCKET_SETTINGS),
          },
        })
        return result(response, {
          bucket: select(record(json(response)), BUCKET_FIELDS),
          etag: response.headers.etag ?? null,
        })
      }
      case 'get_bucket':
      case 'update_bucket': {
        const response = await call(
          input.operation === 'get_bucket' ? 'GET' : 'POST',
          `${bucketPath}/`,
          {
            headers: conditions(input),
            ...(input.operation === 'get_bucket'
              ? { query: { fields: 'approximateCount,approximateSize' } }
              : { body: select(input, BUCKET_SETTINGS) }),
          }
        )
        return result(response, {
          bucket: select(record(json(response)), BUCKET_FIELDS),
          etag: response.headers.etag ?? null,
        })
      }
      case 'delete_bucket': {
        const response = await call('DELETE', `${bucketPath}/`, { headers: conditions(input) })
        return result(response, { ...identity, deleted: true })
      }
      case 'list_objects':
      case 'list_object_versions': {
        const versions = input.operation === 'list_object_versions'
        const response = await call('GET', `${bucketPath}/${versions ? 'objectversions' : 'o'}`, {
          query: {
            ...select(input, [
              'prefix',
              'start',
              'end',
              'startAfter',
              'delimiter',
              'limit',
              'page',
            ]),
            fields: OBJECT_FIELDS.join(','),
          },
        })
        const data = record(json(response))
        return result(response, {
          ...identity,
          [versions ? 'versions' : 'objects']: items(
            data[versions ? 'items' : 'objects'] ?? [],
            versions ? [...OBJECT_FIELDS, 'versionId', 'isDeleteMarker'] : OBJECT_FIELDS,
            input.limit
          ),
          prefixes:
            Array.isArray(data.prefixes) &&
            data.prefixes.every((value) => typeof value === 'string')
              ? data.prefixes
              : [],
          ...(versions
            ? { nextPage: token(response.headers['opc-next-page']) }
            : { nextStartWith: token(data.nextStartWith) }),
        })
      }
      case 'head_object':
      case 'download_object':
      case 'delete_object': {
        const response = await call(
          input.operation === 'head_object'
            ? 'HEAD'
            : input.operation === 'delete_object'
              ? 'DELETE'
              : 'GET',
          `${bucketPath}/o/${encodeOciNativePathValue(input.objectName)}`,
          {
            query: { versionId: input.versionId },
            headers: conditions(input),
            download: input.operation === 'download_object',
          }
        )
        const output = { ...identity, objectName: input.objectName, ...objectHeaders(response) }
        if (input.operation === 'download_object') {
          assertKnownSizeWithinLimit(
            response.body.byteLength,
            MAX_BUFFERED_TRANSFER_BYTES,
            'OCI download'
          )
          if (!context.userId)
            throw new OciNativeOperationError('File storage requires an authenticated user', 403)
          const name = input.objectName.split('/').pop() || 'download'
          const contentType = response.headers['content-type'] ?? 'application/octet-stream'
          const buffer = Buffer.from(response.body)
          signal.throwIfAborted()
          // Persist before the internal JSON handoff; FileToolProcessor preserves an existing UserFile.
          const file =
            context.workflowId && context.executionId
              ? await uploadExecutionFile(
                  {
                    workspaceId: context.workspaceId,
                    workflowId: context.workflowId,
                    executionId: context.executionId,
                  },
                  buffer,
                  name,
                  contentType,
                  context.userId
                )
              : await uploadCopilotFile({
                  buffer,
                  fileName: name,
                  contentType,
                  userId: context.userId,
                })
          signal.throwIfAborted()
          return result(response, { ...output, contentLength: response.body.byteLength, file })
        }
        return result(response, {
          ...output,
          ...(input.operation === 'delete_object' ? { deleted: true } : {}),
        })
      }
      case 'upload_object':
      case 'upload_part': {
        const upload = await uploadBody(input, { ...context, signal })
        const part = input.operation === 'upload_part'
        const contentHeaders: Record<string, string> = {}
        if (!part) {
          for (const [key, header] of Object.entries({
            contentLanguage: 'content-language',
            contentEncoding: 'content-encoding',
            contentDisposition: 'content-disposition',
            cacheControl: 'cache-control',
            storageTier: 'storage-tier',
          } as const)) {
            const value = input[key as keyof typeof input]
            if (typeof value === 'string') contentHeaders[header] = value
          }
          Object.assign(contentHeaders, metadata(input.metadata))
        }
        const response = await call(
          'PUT',
          `${bucketPath}/${part ? 'u' : 'o'}/${encodeOciNativePathValue(input.objectName)}`,
          {
            bytes: upload.body,
            contentType: upload.contentType,
            headers: {
              ...conditions(input),
              ...contentHeaders,
              ...(input.contentMd5 ? { 'content-md5': input.contentMd5 } : {}),
            },
            query: part ? { uploadId: input.uploadId, uploadPartNum: input.partNumber } : undefined,
          }
        )
        return result(response, {
          ...identity,
          objectName: input.objectName,
          ...objectHeaders(response),
          size: upload.body.byteLength,
          contentType: upload.contentType,
          ...(part ? { uploadId: input.uploadId, partNumber: input.partNumber } : {}),
        })
      }
      case 'copy_object': {
        const response = await call('POST', `${bucketPath}/actions/copyObject`, {
          body: {
            sourceObjectName: input.objectName,
            ...select(input, [
              'destinationRegion',
              'destinationNamespace',
              'destinationBucket',
              'destinationObjectName',
              'sourceVersionId',
              'sourceObjectIfMatchETag',
              'destinationObjectIfMatchETag',
              'destinationObjectIfNoneMatchETag',
              'destinationObjectStorageTier',
            ]),
            ...(input.destinationObjectMetadata
              ? { destinationObjectMetadata: metadata(input.destinationObjectMetadata) }
              : {}),
          },
        })
        return result(response, {
          ...identity,
          objectName: input.objectName,
          accepted: true,
          workRequestId: response.headers['opc-work-request-id'] ?? null,
        })
      }
      case 'rename_object': {
        const response = await call('POST', `${bucketPath}/actions/renameObject`, {
          body: {
            sourceName: input.objectName,
            ...select(input, [
              'newName',
              'srcObjIfMatchETag',
              'newObjIfMatchETag',
              'newObjIfNoneMatchETag',
            ]),
          },
        })
        return result(response, {
          ...identity,
          objectName: input.newName,
          ...objectHeaders(response),
        })
      }
      case 'batch_delete_objects': {
        const response = await call('POST', `${bucketPath}/actions/batchDeleteObjects`, {
          body: { objects: input.objects, isSkipDeletedResult: input.isSkipDeletedResult },
        })
        const data = record(json(response))
        const failed = items(data.failed ?? [], ['objectName', 'statusCode', 'errorMessage'])
        return result(response, {
          ...identity,
          deleted: items(data.deleted ?? [], ['objectName', 'timeLastModified']),
          failed,
          allSucceeded: failed.length === 0,
        })
      }
      case 'restore_object':
      case 'update_object_storage_tier': {
        const response = await call(
          'POST',
          `${bucketPath}/actions/${input.operation === 'restore_object' ? 'restoreObjects' : 'updateObjectStorageTier'}`,
          {
            body: select(input, ['objectName', 'versionId', 'hours', 'storageTier']),
          }
        )
        return result(response, {
          ...identity,
          objectName: input.objectName,
          accepted: true,
          versionId: input.versionId ?? null,
        })
      }
      case 'get_lifecycle_policy':
      case 'put_lifecycle_policy':
      case 'delete_lifecycle_policy': {
        const response = await call(
          input.operation === 'get_lifecycle_policy'
            ? 'GET'
            : input.operation === 'put_lifecycle_policy'
              ? 'PUT'
              : 'DELETE',
          `${bucketPath}/l`,
          {
            headers: input.operation === 'get_lifecycle_policy' ? {} : conditions(input),
            ...(input.operation === 'put_lifecycle_policy' ? { body: { items: input.rules } } : {}),
          }
        )
        if (input.operation === 'delete_lifecycle_policy')
          return result(response, { ...identity, deleted: true })
        const data = record(json(response))
        return result(response, {
          ...identity,
          rules: items(data.items ?? [], [
            'name',
            'action',
            'timeAmount',
            'timeUnit',
            'isEnabled',
            'target',
            'objectNameFilter',
          ]),
          timeCreated: data.timeCreated ?? null,
          etag: response.headers.etag ?? null,
        })
      }
      case 'create_multipart_upload': {
        const response = await call('POST', `${bucketPath}/u`, {
          headers: conditions(input),
          body: {
            object: input.objectName,
            ...select(input, CONTENT_SETTINGS),
            ...(input.metadata ? { metadata: metadata(input.metadata) } : {}),
          },
        })
        return result(response, { upload: select(record(json(response)), UPLOAD_FIELDS) })
      }
      case 'list_multipart_uploads':
      case 'list_multipart_parts': {
        const parts = input.operation === 'list_multipart_parts'
        const response = await call(
          'GET',
          `${bucketPath}/u${parts ? `/${encodeOciNativePathValue(input.objectName)}` : ''}`,
          { query: select(input, ['limit', 'page', 'uploadId']) }
        )
        return result(response, {
          ...identity,
          ...(parts ? { objectName: input.objectName } : {}),
          [parts ? 'parts' : 'uploads']: items(
            json(response),
            parts ? ['etag', 'md5', 'size', 'partNumber'] : UPLOAD_FIELDS,
            input.limit
          ),
          nextPage: token(response.headers['opc-next-page']),
        })
      }
      case 'commit_multipart_upload':
      case 'abort_multipart_upload': {
        const response = await call(
          input.operation === 'commit_multipart_upload' ? 'POST' : 'DELETE',
          `${bucketPath}/u/${encodeOciNativePathValue(input.objectName)}`,
          {
            query: { uploadId: input.uploadId },
            ...(input.operation === 'commit_multipart_upload'
              ? {
                  headers: conditions(input),
                  body: select(input, ['partsToCommit', 'partsToExclude']),
                }
              : {}),
          }
        )
        return result(response, {
          ...identity,
          objectName: input.objectName,
          uploadId: input.uploadId,
          ...objectHeaders(response),
          ...(input.operation === 'abort_multipart_upload' ? { aborted: true } : {}),
        })
      }
      case 'create_preauthenticated_request': {
        const response = await call('POST', `${bucketPath}/p/`, {
          body: select(input, [
            'name',
            'accessType',
            'objectName',
            'timeExpires',
            'bucketListingAction',
          ]),
        })
        const data = record(json(response))
        if (
          typeof data.accessUri !== 'string' ||
          !data.accessUri.startsWith('/p/') ||
          data.accessUri.startsWith('//') ||
          data.accessUri.length > 3_500
        )
          throw new OciNativeOperationError('Unexpected pre-authenticated access URI', 502)
        const url = new URL(data.accessUri, endpoint.origin)
        if (url.origin !== endpoint.origin || url.username || url.password)
          throw new OciNativeOperationError('Unexpected pre-authenticated access URI', 502)
        return result(response, { request: select(data, PAR_FIELDS), accessUrl: url.href })
      }
      case 'list_preauthenticated_requests': {
        const response = await call('GET', `${bucketPath}/p/`, {
          query: select(input, ['limit', 'page', 'objectNamePrefix']),
        })
        return result(response, {
          ...identity,
          requests: items(json(response), PAR_FIELDS, input.limit),
          nextPage: token(response.headers['opc-next-page']),
        })
      }
      case 'get_preauthenticated_request':
      case 'delete_preauthenticated_request': {
        const response = await call(
          input.operation === 'get_preauthenticated_request' ? 'GET' : 'DELETE',
          `${bucketPath}/p/${encodeOciNativePathValue(input.parId)}`
        )
        return result(
          response,
          input.operation === 'get_preauthenticated_request'
            ? { request: select(record(json(response)), PAR_FIELDS) }
            : { ...identity, parId: input.parId, deleted: true }
        )
      }
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    if (controller.signal.aborted)
      throw new OciNativeOperationError('OCI operation deadline exceeded', 504)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
