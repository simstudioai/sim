import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type SailpointQueryBody,
  sailpointQueryContract,
} from '@/lib/api/contracts/tools/sailpoint'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getSailPointErrorMessage,
  normalizeApiVersion,
  readTotalCount,
  type SailPointFetchResult,
  type SailPointHosts,
  type SailPointServerCredentials,
  sailpointFetch,
} from '@/app/api/tools/sailpoint/client'

const logger = createLogger('SailPointQueryAPI')

/**
 * Operations for which an empty result set warrants a diagnostic. These read endpoints are userAuth
 * gated, so an empty 200 commonly means the PAT lacks the required user level (e.g. an API-Management
 * client with no user context) or that segmentation restricts visibility.
 */
const EMPTY_DIAGNOSTIC_OPERATIONS = new Set([
  'sailpoint_search',
  'sailpoint_list_identities',
  'sailpoint_list_entitlements',
  'sailpoint_list_roles',
])

const EMPTY_RESULT_WARNING =
  'Zero rows returned - this can indicate the PAT lacks sufficient ISC user level (e.g. an API-Management client with no user context), or that Data Segmentation / Access Request Segments restrict visibility. Confirm the PAT is owned by a service identity with the required user level and scopes.'

type ResultKind = 'list' | 'search' | 'item' | 'count' | 'write'

function diagnose(operation: string, count: number): { complete: boolean; warnings: string[] } {
  if (count === 0 && EMPTY_DIAGNOSTIC_OPERATIONS.has(operation)) {
    return { complete: false, warnings: [EMPTY_RESULT_WARNING] }
  }
  return { complete: true, warnings: [] }
}

/** Builds a `?a=b&c=d` query string, dropping undefined/null/empty values. */
function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    usp.set(key, String(value))
  }
  const serialized = usp.toString()
  return serialized ? `?${serialized}` : ''
}

/** Normalizes an array/JSON-string/comma-list into a string[] (or undefined when empty). */
function toStringList(value: unknown): string[] | undefined {
  if (value == null) return undefined
  if (Array.isArray(value)) {
    const arr = value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    return arr.length ? arr : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          const arr = parsed.filter((v): v is string => typeof v === 'string')
          return arr.length ? arr : undefined
        }
      } catch {
        // fall through to comma splitting
      }
    }
    const parts = trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.length ? parts : undefined
  }
  return undefined
}

function id(value: string): string {
  return encodeURIComponent(value)
}

function errorResponse(result: SailPointFetchResult): NextResponse {
  return NextResponse.json(
    { success: false, error: getSailPointErrorMessage(result.data, 'SailPoint request failed') },
    { status: result.status || 502 }
  )
}

function buildListOutput(
  result: SailPointFetchResult,
  operation: string,
  key: 'items' | 'results'
) {
  const items = Array.isArray(result.data) ? result.data : []
  const { complete, warnings } = diagnose(operation, items.length)
  const base = {
    count: items.length,
    totalCount: readTotalCount(result.headers),
    complete,
    warnings,
  }
  return key === 'results' ? { results: items, ...base } : { items, ...base }
}

async function execute(
  creds: SailPointServerCredentials,
  operation: string,
  buildRequest: (token: string, hosts: SailPointHosts) => { url: string; init: RequestInit },
  kind: ResultKind
): Promise<NextResponse> {
  const result = await sailpointFetch(creds, buildRequest)
  if (!result.ok) return errorResponse(result)

  let output: Record<string, unknown>
  switch (kind) {
    case 'list':
      output = buildListOutput(result, operation, 'items')
      break
    case 'search':
      output = buildListOutput(result, operation, 'results')
      break
    case 'item':
      output = { item: result.data ?? null }
      break
    case 'count':
      output = {
        total:
          readTotalCount(result.headers) ?? (typeof result.data === 'number' ? result.data : 0),
      }
      break
    case 'write':
      output = { accepted: result.ok, status: result.status }
      break
  }

  return NextResponse.json({ success: true, output })
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function dispatch(
  creds: SailPointServerCredentials,
  body: SailpointQueryBody
): Promise<NextResponse> {
  switch (body.operation) {
    case 'sailpoint_search': {
      const searchBody = filterUndefined({
        indices: toStringList(body.indices) ?? ['identities'],
        query: body.query ? { query: body.query } : undefined,
        sort: toStringList(body.sort),
        searchAfter: toStringList(body.searchAfter),
        // Only send includeNested when explicitly false; the API already defaults it to true.
        includeNested: body.includeNested === false ? false : undefined,
      })
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/search${qs({ limit: body.limit, offset: body.offset, count: body.count })}`,
          init: jsonInit(searchBody),
        }),
        'search'
      )
    }
    case 'sailpoint_search_count': {
      const searchBody = filterUndefined({
        indices: toStringList(body.indices) ?? ['identities'],
        query: body.query ? { query: body.query } : undefined,
      })
      return execute(
        creds,
        body.operation,
        (_t, h) => ({ url: `${h.apiBaseUrl}/search/count`, init: jsonInit(searchBody) }),
        'count'
      )
    }
    case 'sailpoint_search_aggregate': {
      const searchBody = filterUndefined({
        indices: toStringList(body.indices) ?? ['identities'],
        query: body.query ? { query: body.query } : undefined,
        aggregationsDsl: body.aggregationsDsl,
      })
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/search/aggregate${qs({ limit: body.limit, offset: body.offset })}`,
          init: jsonInit(searchBody),
        }),
        // /search/aggregate returns an AggregationResult object (aggregations + hits), not an
        // array - route it as an item so the buckets are preserved rather than dropped.
        'item'
      )
    }
    case 'sailpoint_list_identities':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/identities${qs({ filters: body.filters, sorters: body.sorters, defaultFilter: body.defaultFilter, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_identity':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({ url: `${h.apiBaseUrl}/identities/${id(body.id)}`, init: { method: 'GET' } }),
        'item'
      )
    case 'sailpoint_list_accounts':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/accounts${qs({ filters: body.filters, sorters: body.sorters, detailLevel: body.detailLevel, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_account':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({ url: `${h.apiBaseUrl}/accounts/${id(body.id)}`, init: { method: 'GET' } }),
        'item'
      )
    case 'sailpoint_get_account_entitlements':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/accounts/${id(body.id)}/entitlements${qs({ limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_entitlements':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/entitlements${qs({ filters: body.filters, sorters: body.sorters, 'account-id': body.accountId, 'segmented-for-identity': body.segmentedForIdentity, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_entitlement':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/entitlements/${id(body.id)}`,
          init: { method: 'GET' },
        }),
        'item'
      )
    case 'sailpoint_list_roles':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/roles${qs({ filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_role_entitlements':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/roles/${id(body.id)}/entitlements${qs({ filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_access_profiles':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/access-profiles${qs({ filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_access_profile_entitlements':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/access-profiles/${id(body.id)}/entitlements${qs({ filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_sources':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/sources${qs({ filters: body.filters, sorters: body.sorters, 'for-subadmin': body.forSubadmin, includeIDNSource: body.includeIDNSource, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_source':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({ url: `${h.apiBaseUrl}/sources/${id(body.id)}`, init: { method: 'GET' } }),
        'item'
      )
    case 'sailpoint_list_account_activities':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/account-activities${qs({ 'requested-for': body.requestedFor, 'requested-by': body.requestedBy, 'regarding-identity': body.regardingIdentity, filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_account_activity':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/account-activities/${id(body.id)}`,
          init: { method: 'GET' },
        }),
        'item'
      )
    case 'sailpoint_list_campaigns':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/campaigns${qs({ detail: body.detail, filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_get_campaign':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/campaigns/${id(body.id)}${qs({ detail: body.detail })}`,
          init: { method: 'GET' },
        }),
        'item'
      )
    case 'sailpoint_list_certifications':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/certifications${qs({ 'reviewer-identity': body.reviewerIdentity, filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_list_certification_review_items':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/certifications/${id(body.id)}/access-review-items${qs({ filters: body.filters, sorters: body.sorters, entitlements: body.entitlements, 'access-profiles': body.accessProfiles, roles: body.roles, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
    case 'sailpoint_request_access': {
      const requestBody = filterUndefined({
        requestedFor: body.requestedFor,
        requestedItems: body.requestedItems,
        requestType: body.requestType,
        clientMetadata: body.clientMetadata,
      })
      return execute(
        creds,
        body.operation,
        (_t, h) => ({ url: `${h.apiBaseUrl}/access-requests`, init: jsonInit(requestBody) }),
        'write'
      )
    }
    case 'sailpoint_cancel_access_request':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/access-requests/cancel`,
          init: jsonInit({ accountActivityId: body.accountActivityId, comment: body.comment }),
        }),
        'write'
      )
    case 'sailpoint_get_access_request_status':
      return execute(
        creds,
        body.operation,
        (_t, h) => ({
          url: `${h.apiBaseUrl}/access-request-status${qs({ 'requested-for': body.requestedFor, 'requested-by': body.requestedBy, 'regarding-identity': body.regardingIdentity, 'assigned-to': body.assignedTo, 'request-state': body.requestState, filters: body.filters, sorters: body.sorters, limit: body.limit, offset: body.offset, count: body.count })}`,
          init: { method: 'GET' },
        }),
        'list'
      )
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const parsed = await parseRequest(
      sailpointQueryContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid SailPoint request'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const creds: SailPointServerCredentials = {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      tenant: body.tenant,
      apiVersion: normalizeApiVersion(body.apiVersion),
    }

    logger.info(`[${requestId}] SailPoint request`, {
      operation: body.operation,
      apiVersion: creds.apiVersion,
    })

    return await dispatch(creds, body)
  } catch (error) {
    const message = toError(error).message
    logger.error(`[${requestId}] SailPoint request failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
