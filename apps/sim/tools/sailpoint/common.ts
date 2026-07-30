import type { ToolConfig } from '@/tools/types'

/**
 * Internal route that performs the SailPoint client-credentials token exchange (with
 * caching + 429 backoff) and proxies all JSON read/write operations. Tools never call
 * the SailPoint API directly - the per-tenant host, version prefix, and bearer token
 * are all resolved server-side.
 */
export const SAILPOINT_QUERY_ROUTE = '/api/tools/sailpoint/query'

/** Internal route for the multipart CSV aggregation writes (load-accounts / load-entitlements). */
export const SAILPOINT_LOAD_ROUTE = '/api/tools/sailpoint/load'

/**
 * Credential params shared by every SailPoint tool. The credential is a Personal Access
 * Token (PAT) owned by a dedicated ISC service identity - see the block longDescription
 * for the required scopes and the service-identity caveat.
 */
export const sailpointCredentialParams = {
  clientId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'SailPoint PAT client ID (from a service-identity Personal Access Token)',
  },
  clientSecret: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'SailPoint PAT client secret',
  },
  tenant: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'SailPoint tenant (subdomain of api.identitynow.com, e.g. "acme")',
  },
  apiVersion: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'API version path segment: v2025 (default), v2024, or v3',
  },
} as const satisfies ToolConfig['params']

/** Standard pagination params reused across list operations. */
export const sailpointPaginationParams = {
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum number of records to return',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Pagination offset (0-based)',
  },
  count: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'When true, include the total record count (X-Total-Count) in the response',
  },
} as const satisfies ToolConfig['params']

/** Output shape for paginated list operations (raw documents + empty-result diagnostic). */
export const sailpointListOutputs = {
  items: { type: 'json', description: 'Array of raw SailPoint documents for this page' },
  count: { type: 'number', description: 'Number of records returned in this page' },
  totalCount: {
    type: 'number',
    description: 'Total matching records when count=true, otherwise null',
    optional: true,
    nullable: true,
  },
  complete: {
    type: 'boolean',
    description: 'False when an empty result may indicate insufficient user level or segmentation',
  },
  warnings: { type: 'json', description: 'Diagnostic warnings (e.g. empty-result guidance)' },
} as const satisfies ToolConfig['outputs']

/** Output shape for POST /search (raw documents under `results`). */
export const sailpointSearchOutputs = {
  results: { type: 'json', description: 'Array of raw SailPoint search documents' },
  count: { type: 'number', description: 'Number of documents returned in this page' },
  totalCount: {
    type: 'number',
    description: 'Total matching documents when count=true, otherwise null',
    optional: true,
    nullable: true,
  },
  complete: {
    type: 'boolean',
    description: 'False when an empty result may indicate insufficient user level or segmentation',
  },
  warnings: { type: 'json', description: 'Diagnostic warnings (e.g. empty-result guidance)' },
} as const satisfies ToolConfig['outputs']

/** Output shape for single-entity get operations. */
export const sailpointItemOutputs = {
  item: { type: 'json', description: 'Raw SailPoint document' },
} as const satisfies ToolConfig['outputs']

/** Output shape for POST /search/count. */
export const sailpointCountOutputs = {
  total: { type: 'number', description: 'Total matching documents (X-Total-Count)' },
} as const satisfies ToolConfig['outputs']

/** Output shape for access-request create/cancel (202, empty body). */
export const sailpointWriteOutputs = {
  accepted: { type: 'boolean', description: 'True when SailPoint accepted the request (HTTP 202)' },
  status: { type: 'number', description: 'HTTP status returned by SailPoint' },
} as const satisfies ToolConfig['outputs']

/** Output shape for the CSV aggregation writes (task object). */
export const sailpointTaskOutputs = {
  task: {
    type: 'json',
    description: 'Aggregation task returned by SailPoint (LoadAccountsTask / LoadEntitlementTask)',
  },
} as const satisfies ToolConfig['outputs']

/**
 * Unwraps the `{ success, output }` envelope returned by the internal SailPoint routes and
 * throws a descriptive error when the route reports failure. Shared by every SailPoint tool's
 * `transformResponse`.
 */
export async function unwrapSailPointOutput<T = Record<string, unknown>>(
  response: Response,
  fallbackError = 'SailPoint request failed'
): Promise<{ success: true; output: T }> {
  const data = await response.json().catch(() => null)

  if (!response.ok || !data || data.success === false) {
    throw new Error(data?.error || fallbackError)
  }

  return { success: true, output: (data.output ?? {}) as T }
}
