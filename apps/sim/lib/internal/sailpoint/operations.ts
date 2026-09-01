import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { filterUndefined, isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  getSailPointErrorMessage,
  readTotalCount,
  type SailPointCredentials,
  type SailPointFetchResult,
  type SailPointHosts,
  sailpointFetch,
} from '@/lib/internal/sailpoint/client'
import type { SailPointInput } from '@/lib/internal/sailpoint/schema'
import { parseRawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('SailPointOperations')

export const MAX_SAILPOINT_CSV_BYTES = 25 * 1024 * 1024

export interface SailPointOperationContext {
  requestId: string
  signal?: AbortSignal
  userId?: string
}

type InputRecord = SailPointInput & Record<string, unknown>
type ResourceKey =
  | 'accessProfile'
  | 'accessRequestConfig'
  | 'account'
  | 'accountActivity'
  | 'accountSelections'
  | 'campaign'
  | 'certification'
  | 'entitlement'
  | 'entitlementRequestConfig'
  | 'identity'
  | 'role'
  | 'source'
  | 'task'
type ResultKind =
  | 'aggregate'
  | 'count'
  | 'list'
  | 'request-access'
  | 'search'
  | 'write'
  | ResourceKey

const RESOURCE_KEYS = new Set<ResultKind>([
  'accessProfile',
  'accessRequestConfig',
  'account',
  'accountActivity',
  'accountSelections',
  'campaign',
  'certification',
  'entitlement',
  'entitlementRequestConfig',
  'identity',
  'role',
  'source',
  'task',
])

function queryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

function encodeId(value: unknown): string {
  return encodeURIComponent(String(value))
}

function toStringList(value: unknown): string[] | undefined {
  if (value == null) return undefined
  const normalize = (entry: unknown): string | null => {
    if (typeof entry === 'string') return entry.trim() || null
    if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry)
    return null
  }
  if (Array.isArray(value)) {
    const values = value.map(normalize).filter((entry): entry is string => entry !== null)
    return values.length ? values : undefined
  }
  if (typeof value === 'string') {
    const values = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return values.length ? values : undefined
  }
  return undefined
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function searchBody(input: InputRecord): Record<string, unknown> {
  return filterUndefined({
    indices: toStringList(input.indices),
    queryType: input.queryType,
    queryVersion: input.queryVersion,
    query: typeof input.query === 'string' ? { query: input.query } : input.query,
    queryDsl: input.queryDsl,
    textQuery: input.textQuery,
    typeAheadQuery: input.typeAheadQuery,
    includeNested: input.includeNested,
    queryResultFilter: input.queryResultFilter,
    aggregationType:
      input.aggregationType ?? (input.aggregationsDsl !== undefined ? 'DSL' : undefined),
    aggregationsVersion: input.aggregationsVersion,
    aggregationsDsl: input.aggregationsDsl,
    aggregations: input.aggregations,
    sort: toStringList(input.sort),
    searchAfter: toStringList(input.searchAfter),
    filters: input.filters,
  })
}

function accessRequestBody(input: InputRecord): Record<string, unknown> {
  return filterUndefined({
    requestedFor: input.requestedFor,
    requestedItems: input.requestedItems,
    requestedForWithRequestedItems: input.requestedForWithRequestedItems,
    requestType: input.requestType,
    clientMetadata: input.clientMetadata,
  })
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

function providerFailure(result: SailPointFetchResult): Response {
  return failureResponse(
    getSailPointErrorMessage(result.data, 'SailPoint request failed'),
    result.status || 502
  )
}

function requireArray(result: SailPointFetchResult): unknown[] | Response {
  if (Array.isArray(result.data)) return result.data
  return failureResponse('SailPoint returned an invalid list response', 502)
}

function outputForResult(result: SailPointFetchResult, kind: ResultKind): Response {
  if (!result.ok) return providerFailure(result)

  if (kind === 'list' || kind === 'search') {
    const items = requireArray(result)
    if (items instanceof Response) return items
    const output = {
      count: items.length,
      totalCount: readTotalCount(result.headers),
      ...(kind === 'search' ? { results: items } : { items }),
    }
    return Response.json({ success: true, output })
  }

  if (kind === 'count') {
    const total =
      readTotalCount(result.headers) ?? (typeof result.data === 'number' ? result.data : null)
    if (total === null) {
      return failureResponse('SailPoint did not return X-Total-Count', 502)
    }
    return Response.json({ success: true, output: { total } })
  }

  if (kind === 'aggregate') {
    if (!isRecordLike(result.data)) {
      return failureResponse('SailPoint returned an invalid aggregate response', 502)
    }
    const aggregate = result.data
    if (aggregate.aggregations !== undefined && !isRecordLike(aggregate.aggregations)) {
      return failureResponse('SailPoint returned invalid aggregation results', 502)
    }
    if (aggregate.hits !== undefined && !Array.isArray(aggregate.hits)) {
      return failureResponse('SailPoint returned invalid aggregation hits', 502)
    }
    return Response.json({
      success: true,
      output: {
        aggregations: aggregate.aggregations ?? null,
        hits: Array.isArray(aggregate.hits) ? aggregate.hits : [],
        totalCount: readTotalCount(result.headers),
      },
    })
  }

  if (RESOURCE_KEYS.has(kind)) {
    if (!isRecordLike(result.data)) {
      return failureResponse('SailPoint returned an invalid resource response', 502)
    }
    return Response.json({ success: true, output: { [kind]: result.data } })
  }

  if (kind === 'request-access') {
    if (!isRecordLike(result.data)) {
      return failureResponse('SailPoint returned an invalid access-request response', 502)
    }
    const response = result.data
    if (response.newRequests !== undefined && !Array.isArray(response.newRequests)) {
      return failureResponse('SailPoint returned invalid new access-request records', 502)
    }
    if (response.existingRequests !== undefined && !Array.isArray(response.existingRequests)) {
      return failureResponse('SailPoint returned invalid existing access-request records', 502)
    }
    return Response.json({
      success: true,
      output: {
        accepted: true,
        status: result.status,
        newRequests: Array.isArray(response.newRequests) ? response.newRequests : [],
        existingRequests: Array.isArray(response.existingRequests) ? response.existingRequests : [],
      },
    })
  }

  return Response.json({
    success: true,
    output: { accepted: true, status: result.status },
  })
}

async function executeRequest(
  credentials: SailPointCredentials,
  context: SailPointOperationContext,
  buildRequest: (hosts: SailPointHosts) => { init: RequestInit; url: string },
  kind: ResultKind
): Promise<Response> {
  const result = await sailpointFetch(credentials, buildRequest, { signal: context.signal })
  return outputForResult(result, kind)
}

async function executeLoad(
  input: InputRecord,
  credentials: SailPointCredentials,
  context: SailPointOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  let fileBuffer: Buffer | null = null
  let fileName = 'aggregation.csv'
  let fileType = 'text/csv'

  if (input.file != null) {
    if (!context.userId) return failureResponse('Authentication required for stored files', 401)
    const parsedFile = parseRawFileInput(input.file)
    if (!parsedFile) return failureResponse('Invalid file input', 400)
    const userFiles = processFilesToUserFiles([parsedFile], context.requestId, logger)
    const userFile = userFiles[0]
    if (!userFile) return failureResponse('Invalid file input', 400)

    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) return denied

    try {
      const downloaded = await downloadServableFileFromStorage(
        userFile,
        context.requestId,
        logger,
        { maxBytes: MAX_SAILPOINT_CSV_BYTES, signal: context.signal }
      )
      fileBuffer = downloaded.buffer
      fileName = userFile.name || fileName
      fileType = userFile.type || fileType
    } catch (error) {
      context.signal?.throwIfAborted()
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      if (isPayloadSizeLimitError(error)) {
        return failureResponse('SailPoint CSV file exceeds the 25 MiB limit', 400)
      }
      logger.error('Failed to download SailPoint CSV file', {
        error: getErrorMessage(error),
        requestId: context.requestId,
      })
      return failureResponse(getErrorMessage(error, 'Failed to download file'), 500)
    }
  }

  const isAccountLoad = input.operation === 'sailpoint_load_accounts'
  const path = isAccountLoad
    ? `/sources/v1/${encodeId(input.sourceId)}/load-accounts`
    : `/sources/v1/${encodeId(input.sourceId)}/load-entitlements`

  const result = await sailpointFetch(
    credentials,
    (hosts) => {
      const form = new FormData()
      if (fileBuffer !== null) {
        form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: fileType }), fileName)
      }
      if (isAccountLoad && input.disableOptimization === true) {
        form.append('disableOptimization', 'true')
      }
      return { url: `${hosts.apiBaseUrl}${path}`, init: { method: 'POST', body: form } }
    },
    { signal: context.signal }
  )
  if (!result.ok) return providerFailure(result)
  if (isAccountLoad) {
    const body = isRecordLike(result.data) ? result.data : null
    if (!body || !isRecordLike(body.task)) {
      return failureResponse('SailPoint returned an invalid account-load task response', 502)
    }
    return Response.json({
      success: true,
      output: { success: body.success === true, task: body.task ?? null },
    })
  }
  if (!isRecordLike(result.data)) {
    return failureResponse('SailPoint returned an invalid entitlement-load task response', 502)
  }
  return Response.json({ success: true, output: { task: result.data } })
}

export async function executeSailPointOperation(
  parsedInput: SailPointInput,
  context: SailPointOperationContext
): Promise<Response> {
  const input = parsedInput as InputRecord
  const credentials: SailPointCredentials = {
    clientId: String(input.clientId),
    clientSecret: String(input.clientSecret),
    tenant: String(input.tenant),
  }

  switch (input.operation) {
    case 'sailpoint_search': {
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/search/v1${queryString({ limit: input.limit, offset: input.offset, count: input.count })}`,
          init: jsonRequest(searchBody(input)),
        }),
        'search'
      )
    }
    case 'sailpoint_search_count':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/search/v1/count`,
          init: jsonRequest(searchBody(input)),
        }),
        'count'
      )
    case 'sailpoint_search_aggregate':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/search/v1/aggregate${queryString({ limit: input.limit, offset: input.offset, count: input.count })}`,
          init: jsonRequest(searchBody(input)),
        }),
        'aggregate'
      )
    case 'sailpoint_list_identities':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/identities/v1${queryString({ filters: input.filters, sorters: input.sorters, defaultFilter: input.defaultFilter, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_identity':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/identities/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'identity'
      )
    case 'sailpoint_list_identity_entitlements':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/entitlements/v1/identities/${encodeId(input.id)}/entitlements${queryString({ limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_accounts':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/accounts/v1${queryString({ filters: input.filters, sorters: input.sorters, detailLevel: input.detailLevel, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_account':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/accounts/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'account'
      )
    case 'sailpoint_get_account_entitlements':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/accounts/v1/${encodeId(input.id)}/entitlements${queryString({ limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_entitlements':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/entitlements/v1${queryString({ filters: input.filters, sorters: input.sorters, 'segmented-for-identity': input.segmentedForIdentity, 'for-segment-ids': input.forSegmentIds, 'include-unsegmented': input.includeUnsegmented, searchAfter: input.searchAfter, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_entitlement':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/entitlements/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'entitlement'
      )
    case 'sailpoint_get_entitlement_request_config':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/entitlements/v1/${encodeId(input.id)}/entitlement-request-config`,
          init: { method: 'GET' },
        }),
        'entitlementRequestConfig'
      )
    case 'sailpoint_list_roles':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/roles/v1${queryString({ filters: input.filters, sorters: input.sorters, 'for-subadmin': input.forSubadmin, 'for-segment-ids': input.forSegmentIds, 'include-unsegmented': input.includeUnsegmented, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_role':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/roles/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'role'
      )
    case 'sailpoint_get_role_entitlements':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/roles/v1/${encodeId(input.id)}/entitlements${queryString({ filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_access_profiles':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-profiles/v1${queryString({ filters: input.filters, sorters: input.sorters, 'for-subadmin': input.forSubadmin, 'for-segment-ids': input.forSegmentIds, 'include-unsegmented': input.includeUnsegmented, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_access_profile':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-profiles/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'accessProfile'
      )
    case 'sailpoint_get_access_profile_entitlements':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-profiles/v1/${encodeId(input.id)}/entitlements${queryString({ filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_sources':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/sources/v1${queryString({ filters: input.filters, sorters: input.sorters, 'for-subadmin': input.forSubadmin, includeIDNSource: input.includeIDNSource, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_source':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/sources/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'source'
      )
    case 'sailpoint_list_account_activities':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/account-activities/v1${queryString({ 'requested-for': input.requestedFor, 'requested-by': input.requestedBy, 'regarding-identity': input.regardingIdentity, filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_account_activity':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/account-activities/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'accountActivity'
      )
    case 'sailpoint_list_campaigns':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/campaigns/v1${queryString({ detail: input.detail, filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_campaign':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/campaigns/v1/${encodeId(input.id)}${queryString({ detail: input.detail })}`,
          init: { method: 'GET' },
        }),
        'campaign'
      )
    case 'sailpoint_list_certifications':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/certifications/v1${queryString({ 'reviewer-identity': input.reviewerIdentity, filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_certification':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/certifications/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'certification'
      )
    case 'sailpoint_list_certification_review_items':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/certifications/v1/${encodeId(input.id)}/access-review-items${queryString({ filters: input.filters, sorters: input.sorters, entitlements: input.entitlements, 'access-profiles': input.accessProfiles, roles: input.roles, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_decide_certification_review_items':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/certifications/v1/${encodeId(input.id)}/decide`,
          init: jsonRequest(input.decisions),
        }),
        'certification'
      )
    case 'sailpoint_sign_off_certification':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/certifications/v1/${encodeId(input.id)}/sign-off`,
          init: { method: 'POST' },
        }),
        'certification'
      )
    case 'sailpoint_request_access':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-requests/v1`,
          init: jsonRequest(accessRequestBody(input)),
        }),
        'request-access'
      )
    case 'sailpoint_get_account_selections':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-requests/v1/accounts-selection`,
          init: {
            ...jsonRequest(accessRequestBody(input)),
            headers: {
              'Content-Type': 'application/json',
              'X-SailPoint-Experimental': 'true',
            },
          },
        }),
        'accountSelections'
      )
    case 'sailpoint_get_access_request_config':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-request-config/v2`,
          init: { method: 'GET' },
        }),
        'accessRequestConfig'
      )
    case 'sailpoint_cancel_access_request':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-requests/v1/cancel`,
          init: jsonRequest({
            accountActivityId: input.accountActivityId,
            comment: input.comment,
          }),
        }),
        'write'
      )
    case 'sailpoint_get_access_request_status':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-request-status/v1${queryString({ 'requested-for': input.requestedFor, 'requested-by': input.requestedBy, 'regarding-identity': input.regardingIdentity, 'assigned-to': input.assignedTo, 'request-state': input.requestState, filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_pending_access_request_approvals':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-request-approvals/v1/pending${queryString({ 'owner-id': input.ownerId, filters: input.filters, sorters: input.sorters, limit: input.limit, offset: input.offset, count: input.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_approve_access_request':
    case 'sailpoint_reject_access_request': {
      const action = input.operation === 'sailpoint_approve_access_request' ? 'approve' : 'reject'
      const init = input.comment
        ? jsonRequest({ comment: input.comment })
        : { method: 'POST' as const }
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/access-request-approvals/v1/${encodeId(input.approvalId)}/${action}`,
          init,
        }),
        'write'
      )
    }
    case 'sailpoint_get_task_status':
      return executeRequest(
        credentials,
        context,
        (hosts) => ({
          url: `${hosts.apiBaseUrl}/task-status/v1/${encodeId(input.id)}`,
          init: { method: 'GET' },
        }),
        'task'
      )
    case 'sailpoint_load_accounts':
    case 'sailpoint_load_entitlements':
      return executeLoad(input, credentials, context)
  }
}
