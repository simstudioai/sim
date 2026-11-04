import { z } from 'zod'
import type { PeopleSyncConfig } from '@/lib/api/contracts/people-sync'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { externalDirectoryUsers } from '@/lib/people/provider-import'
import { GRAPH_BATCH_SIZE, MAX_REPORTS_PER_PAGE } from '@/lib/people/sync/limits'
import {
  checkedDirectoryNextLink,
  directoryRetryDelay,
  MAX_NEXT_LINK_LENGTH,
  readDirectoryResponse,
  requireDirectorySuccess,
} from '@/lib/people/sync/provider-request'
import type {
  DirectoryReader,
  DirectoryReportRequest,
  DirectoryReportResult,
} from '@/lib/people/sync/types'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const tokenResponse = z.object({
  access_token: z
    .string()
    .min(1)
    .max(32_768)
    .regex(/^[!-~]+$/),
  token_type: z.string().toLowerCase().pipe(z.literal('bearer')),
})

const batchResponse = z.object({
  responses: z
    .array(
      z.object({
        id: z.string(),
        status: z.number().int(),
        headers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        body: z.unknown(),
      })
    )
    .max(GRAPH_BATCH_SIZE),
})
const reportsResponse = z.object({
  value: z.array(z.object({ id: z.string().min(1).max(512) })).max(MAX_REPORTS_PER_PAGE),
  '@odata.nextLink': z.string().min(1).max(MAX_NEXT_LINK_LENGTH).optional(),
})

const deletedUserResponse = z.object({
  error: z.object({ code: z.literal('Request_ResourceNotFound') }),
})

/** A user deleted after the users phase has no reports left to read; any other 404 still fails. */
function isDeletedUser(status: number, body: unknown) {
  return status === 404 && deletedUserResponse.safeParse(body).success
}

/** App-only Graph tokens cannot read /manager; each user's /directReports supports User.Read.All. */
async function readReportPages(
  items: readonly DirectoryReportRequest[],
  token: string
): Promise<DirectoryReportResult[]> {
  if (!items.length) return []
  if (
    items.length > GRAPH_BATCH_SIZE ||
    new Set(items.map((item) => item.managerId)).size !== items.length
  )
    throw new OrchestrationError(
      'validation',
      'A Graph batch can read one page for each of up to 20 managers.'
    )
  const pages = items.map(({ managerId, cursor }, index) => {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(managerId))
      throw new OrchestrationError('validation', 'Microsoft returned an invalid directory user ID.')
    const endpoint = new URL(`${GRAPH_BASE}/users/${managerId}/directReports`)
    endpoint.searchParams.set('$select', 'id')
    const url = cursor === null ? endpoint : checkedDirectoryNextLink(cursor, endpoint)
    return { id: String(index + 1), managerId, endpoint, url }
  })
  const { data } = await readDirectoryResponse(new URL(`${GRAPH_BASE}/$batch`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: pages.map((page) => ({
        id: page.id,
        method: 'GET',
        url: `${page.url.pathname.slice('/v1.0'.length)}${page.url.search}`,
      })),
    }),
  })
  const parsed = batchResponse.safeParse(data)
  if (!parsed.success || parsed.data.responses.length !== pages.length)
    throw new OrchestrationError(
      'validation',
      'Microsoft returned an incomplete direct reports batch.'
    )
  const byId = new Map(parsed.data.responses.map((response) => [response.id, response]))
  return pages.map((page) => {
    const response = byId.get(page.id)
    if (!response)
      throw new OrchestrationError(
        'validation',
        'Microsoft returned an incomplete direct reports batch.'
      )
    const headers = new Map(
      Object.entries(response.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])
    )
    const timing = { get: (name: string) => headers.get(name) ?? null }
    const retryAfterMs = directoryRetryDelay(response.status, timing)
    if (retryAfterMs !== null) return { managerId: page.managerId, retryAfterMs }
    if (isDeletedUser(response.status, response.body))
      return { managerId: page.managerId, reportIds: [], next: null }
    requireDirectorySuccess(response.status, timing)
    const parsedReports = reportsResponse.safeParse(response.body)
    if (!parsedReports.success)
      throw new OrchestrationError(
        'validation',
        'Microsoft returned an incomplete direct reports page.'
      )
    const href = parsedReports.data['@odata.nextLink']
    const next = href ? checkedDirectoryNextLink(href, page.endpoint).href : null
    if (next === page.url.href)
      throw new OrchestrationError(
        'validation',
        'Microsoft repeated its direct reports pagination link.'
      )
    return {
      managerId: page.managerId,
      reportIds: parsedReports.data.value.map((report) => report.id),
      next,
    }
  })
}

export async function openEntraReader(
  config: Extract<PeopleSyncConfig, { source: 'entra' }>
): Promise<DirectoryReader> {
  const tenantId = config.tenantId.toLowerCase()
  const { data } = await readDirectoryResponse(
    new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    },
    true
  )
  const parsed = tokenResponse.safeParse(data)
  if (!parsed.success)
    throw new OrchestrationError(
      'validation',
      'Microsoft did not issue a valid application access token.'
    )
  const token = parsed.data.access_token
  const reader = externalDirectoryUsers({ source: 'entra', token }, true)
  return {
    sourceId: tenantId,
    users: reader.users,
    reports: (items) => readReportPages(items, token),
  }
}
