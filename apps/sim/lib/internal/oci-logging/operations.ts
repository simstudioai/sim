import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { z } from 'zod'
import type {
  OciAuthenticatedResponse,
  OciClient,
  OciRequest,
} from '@/lib/internal/oci/client.server'
import {
  createOciStaticEndpointPolicy,
  type OciPreparedEndpoint,
} from '@/lib/internal/oci/endpoints'
import {
  logGroupSchema,
  logSchema,
  ociLoggingInputSchemas,
  savedSearchSchema,
  savedSearchSummarySchema,
  searchResponseSchema,
  workRequestErrorSchema,
  workRequestSchema,
} from '@/lib/internal/oci-logging/schema'
import type { OciLoggingOperation, OciLoggingOutputs } from '@/tools/oci_logging/types'

export const OCI_LOGGING_SERVICE_ID = 'oci-logging'
export const OCI_LOGGING_MANAGEMENT_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_LOGGING_SERVICE_ID,
  serviceName: 'logging',
  hostnameTemplate: 'regional-oci',
})
export const OCI_LOGGING_INGESTION_POLICY = createOciStaticEndpointPolicy({
  serviceId: OCI_LOGGING_SERVICE_ID,
  serviceName: 'ingestion.logging',
  hostnameTemplate: 'regional-oci',
})
export interface OciLoggingDestination {
  client: OciClient
  endpoint: OciPreparedEndpoint
}

export class OciLoggingResponseError extends Error {
  constructor() {
    super('OCI Logging returned an invalid response')
  }
}

function parseResponse<T>(response: OciAuthenticatedResponse, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)))
  } catch {
    throw new OciLoggingResponseError()
  }
}

function metadata(response: OciAuthenticatedResponse) {
  return { ...(response.opcRequestId ? { opcRequestId: response.opcRequestId } : {}) }
}

function pageMetadata(response: OciAuthenticatedResponse) {
  return {
    ...metadata(response),
    ...(response.headers['opc-next-page'] ? { nextPage: response.headers['opc-next-page'] } : {}),
  }
}

function resourceMetadata(response: OciAuthenticatedResponse) {
  return {
    ...metadata(response),
    ...(response.headers.etag ? { etag: response.headers.etag } : {}),
  }
}

function queryPairs(input: object): [string, string][] {
  return Object.entries(input).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)] as [string, string]]
  )
}

const groupPath = (id: string) => `/20200531/logGroups/${encodeURIComponent(id)}`
const logPath = (groupId: string, logId: string) =>
  `${groupPath(groupId)}/logs/${encodeURIComponent(logId)}`

export async function executeOciLoggingOperation(
  operation: OciLoggingOperation,
  input: unknown,
  destination: OciLoggingDestination,
  signal?: AbortSignal
): Promise<OciLoggingOutputs[OciLoggingOperation]> {
  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    encodedPath: string,
    options: {
      query?: object
      body?: object
      ifMatch?: string
      retryToken?: string
      accepted?: boolean
    } = {}
  ) {
    signal?.throwIfAborted()
    const base = {
      endpoint: destination.endpoint,
      encodedPath,
      signal,
      timeoutMs: 60_000,
      maxResponseBytes: 10 * 1024 * 1024,
      responseHeaders: ['opc-next-page', 'opc-work-request-id', 'retry-after'],
      queryPairs: queryPairs(options.query ?? {}),
      headers: options.ifMatch === undefined ? undefined : { 'if-match': options.ifMatch },
    }
    let call: OciRequest
    if (method === 'GET') {
      call = { ...base, method, retry: { kind: 'safe', maxAttempts: 2 } }
    } else if (method === 'DELETE') {
      call = { ...base, method }
    } else {
      call = {
        ...base,
        method,
        body: new TextEncoder().encode(JSON.stringify(options.body ?? {})),
        contentType: 'application/json',
        ...(options.retryToken === undefined
          ? {}
          : {
              retry: {
                kind: 'tokenized' as const,
                maxAttempts: 2,
                retryToken: options.retryToken,
              },
            }),
      }
    }
    const response = await destination.client.request(call)
    signal?.throwIfAborted()
    if (response.status !== (options.accepted ? 202 : 200)) throw new OciLoggingResponseError()
    return response
  }

  async function mutate(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: object,
    ifMatch?: string,
    retryToken?: string
  ) {
    const response = await request(method, path, { body, ifMatch, retryToken, accepted: true })
    const workRequestId = response.headers['opc-work-request-id']
    if (!workRequestId) throw new OciLoggingResponseError()
    return { accepted: true as const, workRequestId, ...metadata(response) }
  }

  switch (operation) {
    case 'list_log_groups': {
      const params = ociLoggingInputSchemas.list_log_groups.parse(input)
      const response = await request('GET', '/20200531/logGroups', { query: params })
      return {
        logGroups: parseResponse(response, z.array(logGroupSchema).max(params.limit ?? 100)),
        ...pageMetadata(response),
      }
    }
    case 'get_log_group': {
      const params = ociLoggingInputSchemas.get_log_group.parse(input)
      const response = await request('GET', groupPath(params.logGroupId))
      return { logGroup: parseResponse(response, logGroupSchema), ...resourceMetadata(response) }
    }
    case 'create_log_group': {
      const params = ociLoggingInputSchemas.create_log_group.parse(input)
      return mutate(
        'POST',
        '/20200531/logGroups',
        omit(params, ['retryToken']),
        undefined,
        params.retryToken ?? generateId()
      )
    }
    case 'update_log_group': {
      const params = ociLoggingInputSchemas.update_log_group.parse(input)
      return mutate(
        'PUT',
        groupPath(params.logGroupId),
        omit(params, ['logGroupId', 'ifMatch']),
        params.ifMatch
      )
    }
    case 'delete_log_group': {
      const params = ociLoggingInputSchemas.delete_log_group.parse(input)
      return mutate('DELETE', groupPath(params.logGroupId), undefined, params.ifMatch)
    }
    case 'list_logs': {
      const params = ociLoggingInputSchemas.list_logs.parse(input)
      const response = await request('GET', `${groupPath(params.logGroupId)}/logs`, {
        query: omit(params, ['logGroupId']),
      })
      return {
        logs: parseResponse(response, z.array(logSchema).max(params.limit ?? 100)),
        ...pageMetadata(response),
      }
    }
    case 'get_log': {
      const params = ociLoggingInputSchemas.get_log.parse(input)
      const response = await request('GET', logPath(params.logGroupId, params.logId))
      return { log: parseResponse(response, logSchema), ...resourceMetadata(response) }
    }
    case 'create_log': {
      const params = ociLoggingInputSchemas.create_log.parse(input)
      return mutate(
        'POST',
        `${groupPath(params.logGroupId)}/logs`,
        omit(params, ['logGroupId', 'retryToken']),
        undefined,
        params.retryToken ?? generateId()
      )
    }
    case 'update_log': {
      const params = ociLoggingInputSchemas.update_log.parse(input)
      return mutate(
        'PUT',
        logPath(params.logGroupId, params.logId),
        omit(params, ['logGroupId', 'logId', 'ifMatch']),
        params.ifMatch
      )
    }
    case 'delete_log': {
      const params = ociLoggingInputSchemas.delete_log.parse(input)
      return mutate('DELETE', logPath(params.logGroupId, params.logId), undefined, params.ifMatch)
    }
    case 'search_logs': {
      const params = ociLoggingInputSchemas.search_logs.parse(input)
      const response = await request('POST', '/20190909/search', {
        body: omit(params, ['page', 'limit']),
        query: { page: params.page, limit: params.limit },
      })
      const result = parseResponse(response, searchResponseSchema)
      if (result.results.length > (params.limit ?? 100)) throw new OciLoggingResponseError()
      return { ...result, ...pageMetadata(response) }
    }
    case 'put_logs': {
      const params = ociLoggingInputSchemas.put_logs.parse(input)
      const response = await request(
        'POST',
        `/20200831/logs/${encodeURIComponent(params.logId)}/actions/push`,
        { body: { specversion: '1.0', logEntryBatches: params.logEntryBatches } }
      )
      return { accepted: true, ...metadata(response) }
    }
    case 'get_work_request': {
      const params = ociLoggingInputSchemas.get_work_request.parse(input)
      const response = await request(
        'GET',
        `/20200531/workRequests/${encodeURIComponent(params.workRequestId)}`
      )
      const retryAfter = response.headers['retry-after']
      if (
        retryAfter !== undefined &&
        (!/^\d+(\.\d+)?$/.test(retryAfter) || !Number.isFinite(Number(retryAfter)))
      ) {
        throw new OciLoggingResponseError()
      }
      return {
        workRequest: parseResponse(response, workRequestSchema),
        ...resourceMetadata(response),
        ...(retryAfter === undefined ? {} : { retryAfter: Number(retryAfter) }),
      }
    }
    case 'list_work_request_errors': {
      const params = ociLoggingInputSchemas.list_work_request_errors.parse(input)
      const response = await request(
        'GET',
        `/20200531/workRequests/${encodeURIComponent(params.workRequestId)}/errors`,
        { query: omit(params, ['workRequestId']) }
      )
      return {
        errors: parseResponse(response, z.array(workRequestErrorSchema).max(params.limit ?? 100)),
        ...pageMetadata(response),
      }
    }
    case 'list_saved_searches': {
      const params = ociLoggingInputSchemas.list_saved_searches.parse(input)
      const response = await request('GET', '/20200531/logSavedSearches', { query: params })
      const result = parseResponse(
        response,
        z.object({ items: z.array(savedSearchSummarySchema).max(params.limit ?? 100) })
      )
      return { savedSearches: result.items, ...pageMetadata(response) }
    }
    case 'get_saved_search': {
      const params = ociLoggingInputSchemas.get_saved_search.parse(input)
      const response = await request(
        'GET',
        `/20200531/logSavedSearches/${encodeURIComponent(params.logSavedSearchId)}`
      )
      return {
        savedSearch: parseResponse(response, savedSearchSchema),
        ...resourceMetadata(response),
      }
    }
  }
}
