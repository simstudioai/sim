import { assertGraphNextPageUrl } from '@/tools/sharepoint/utils'

/**
 * Splits a comma or newline separated list of identifiers into a trimmed, de-duplicated array.
 * Used for Microsoft Graph parameters that take GUID collections (SKU IDs, service plan IDs).
 */
export function parseIdList(value: string | undefined | null): string[] {
  if (!value) return []
  const seen = new Set<string>()
  for (const raw of value.split(/[\n,]/)) {
    const trimmed = raw.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Maps a Microsoft Graph `servicePlanInfo` collection to the documented subset of fields.
 * Shared by `licenseDetails` and `subscribedSku` responses, which both embed this type.
 */
export function mapServicePlans(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.map((plan: Record<string, unknown>) => ({
    servicePlanId: plan.servicePlanId ?? null,
    servicePlanName: plan.servicePlanName ?? null,
    provisioningStatus: plan.provisioningStatus ?? null,
    appliesTo: plan.appliesTo ?? null,
  }))
}

/**
 * Builds a Microsoft Graph collection URL, appending only the OData parameters that were
 * supplied. `select` is passed through verbatim; `filter` and `search` are URL-encoded.
 */
export function buildGraphCollectionUrl(
  path: string,
  options: {
    select?: string
    top?: number
    filter?: string
    search?: string
    orderby?: string
    count?: boolean
  }
): string {
  const queryParts: string[] = []
  if (options.select) queryParts.push(`$select=${options.select}`)
  if (options.top) queryParts.push(`$top=${options.top}`)
  if (options.filter) queryParts.push(`$filter=${encodeURIComponent(options.filter)}`)
  if (options.search) queryParts.push(`$search=${encodeURIComponent(options.search)}`)
  if (options.orderby) queryParts.push(`$orderby=${encodeURIComponent(options.orderby)}`)
  if (options.count) queryParts.push('$count=true')
  return queryParts.length > 0
    ? `https://graph.microsoft.com/v1.0/${path}?${queryParts.join('&')}`
    : `https://graph.microsoft.com/v1.0/${path}`
}

/**
 * `$filter` targets Microsoft Graph documents as working **only without** advanced query
 * parameters — the `checkmark-circle-green` legend entry on the advanced-queries page reads
 * "The `$filter` operator only works without advanced query parameters."
 *
 * Sending `$count=true` with `ConsistencyLevel: eventual` alongside one of these fails the
 * request, so the advanced-query pair has to be opt-out rather than unconditional. The common
 * case — an advanced operator (`ne`, `not`, `endsWith`, `startsWith`) on an ordinary property —
 * still gets the pair, because that is the far more frequent 400.
 * @see https://learn.microsoft.com/en-us/graph/aad-advanced-queries
 */
const GRAPH_ADVANCED_QUERY_INCOMPATIBLE_FILTER =
  /\b(?:hasMembersWithLicenseErrors|isLicenseReconciliationNeeded)\b|\bidentities\s*\/\s*any\b/i

/** Decodes a URL for pattern matching, tolerating a malformed escape sequence. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Decides whether a Graph collection request should carry the advanced-query pair —
 * `$count=true` plus a `ConsistencyLevel: eventual` header.
 *
 * `$search` always requires it. A `$filter` requires it for advanced operators, except on the
 * properties in {@link GRAPH_ADVANCED_QUERY_INCOMPATIBLE_FILTER}, which it breaks. A plain
 * request needs neither, which also keeps these tools working in Azure AD B2C tenants, where
 * Graph documents advanced query capabilities as unsupported outright.
 *
 * When continuing from a `nextLink`, the answer is read off the link itself: Graph echoes
 * `$count`/`$search` into the continuation URL, so the follow-up page is advanced exactly when
 * the first page was, regardless of what the filter subBlock still holds.
 * @see https://learn.microsoft.com/en-us/graph/aad-advanced-queries
 */
export function usesGraphAdvancedQuery(params: {
  nextLink?: string
  filter?: string
  search?: string
}): boolean {
  if (params.nextLink) {
    return /[?&]\$(?:count=true|search=)/i.test(safeDecode(params.nextLink))
  }
  if (params.search?.trim()) return true
  const filter = params.filter?.trim()
  if (!filter) return false
  return !GRAPH_ADVANCED_QUERY_INCOMPATIBLE_FILTER.test(filter)
}

/**
 * Builds the Graph collection request headers, adding `ConsistencyLevel: eventual` only when
 * {@link usesGraphAdvancedQuery} says the request carries the advanced-query pair.
 */
export function graphCollectionHeaders(params: {
  accessToken: string
  nextLink?: string
  filter?: string
  search?: string
}): Record<string, string> {
  return {
    Authorization: `Bearer ${params.accessToken}`,
    ...(usesGraphAdvancedQuery(params) ? { ConsistencyLevel: 'eventual' } : {}),
  }
}

/**
 * Validates an `@odata.nextLink` and asserts it continues the collection the caller is querying.
 *
 * Every paged operation reads the one shared Next Page field, and a subBlock keeps its value
 * after the operation changes. Without this check, paging `/users` and then switching the block
 * to `/devices` would short-circuit back to the user page, silently returning the previous
 * collection. Comparing the final path segment also rejects a continuation URL pasted from an
 * unrelated response.
 */
export function assertGraphNextPageUrlForCollection(
  nextPageUrl: string,
  expectedSegments: string[]
): string {
  const url = new URL(assertGraphNextPageUrl(nextPageUrl))
  const segments = url.pathname.split('/').filter(Boolean)
  const collection = segments[segments.length - 1]
  if (!collection || !expectedSegments.includes(collection)) {
    throw new Error(
      `Next Page URL continues "${collection ?? 'an unknown collection'}", but this operation reads "${expectedSegments.join('" or "')}". Clear the Next Page field when switching operations.`
    )
  }
  return url.toString()
}

/**
 * Canonical 8-4-4-4-12 form of an `Edm.Guid`, which is what Microsoft Graph object IDs are.
 * Graph accepts either an object ID or a userPrincipalName in a `/users/{id}` path segment, but
 * body properties typed `Edm.Guid` — `appRoleAssignment.principalId` among them — accept only
 * the object ID.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/approleassignment
 */
const GRAPH_OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a user-supplied identifier is already a Graph object ID rather than a UPN. */
export function isGraphObjectId(value: string): boolean {
  return GRAPH_OBJECT_ID_PATTERN.test(value.trim())
}

/** Extracts the message Microsoft Graph nests under `error.message` in its failure bodies. */
export function extractGraphErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error
    if (
      error &&
      typeof error === 'object' &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message
    }
  }
  return fallback
}

/**
 * Resolves a user identifier to its Graph object ID.
 *
 * Returns the input unchanged when it is already an object ID, so the extra round trip is paid
 * only by callers who supplied a userPrincipalName.
 */
export async function resolveGraphUserObjectId(
  userId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<string> {
  const identifier = userId.trim()
  if (isGraphObjectId(identifier)) return identifier

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identifier)}?$select=id`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal }
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      extractGraphErrorMessage(body, `Failed to resolve user "${identifier}" to an object ID`)
    )
  }

  const objectId = typeof body?.id === 'string' ? body.id : ''
  if (!objectId) {
    throw new Error(`Microsoft Graph returned no object ID for user "${identifier}"`)
  }
  return objectId
}

/** The `device` properties the Microsoft Entra ID tools project into their outputs. */
export const DEVICE_SELECT =
  'id,deviceId,displayName,operatingSystem,operatingSystemVersion,accountEnabled,isCompliant,isManaged,trustType,profileType,manufacturer,model,approximateLastSignInDateTime,registrationDateTime'

/**
 * Maps a Microsoft Graph `conditionalAccessPolicy` resource. The `conditions`, `grantControls`,
 * and `sessionControls` members are passed through as-is because their shape varies with the
 * controls a tenant has configured.
 */
export function mapConditionalAccessPolicy(
  policy: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: policy.id ?? null,
    displayName: policy.displayName ?? null,
    state: policy.state ?? null,
    templateId: policy.templateId ?? null,
    createdDateTime: policy.createdDateTime ?? null,
    modifiedDateTime: policy.modifiedDateTime ?? null,
    conditions: policy.conditions ?? null,
    grantControls: policy.grantControls ?? null,
    sessionControls: policy.sessionControls ?? null,
  }
}

/** Maps a Microsoft Graph `device` resource to the documented subset of fields. */
export function mapDevice(device: Record<string, unknown>): Record<string, unknown> {
  return {
    id: device.id ?? null,
    deviceId: device.deviceId ?? null,
    displayName: device.displayName ?? null,
    operatingSystem: device.operatingSystem ?? null,
    operatingSystemVersion: device.operatingSystemVersion ?? null,
    accountEnabled: device.accountEnabled ?? null,
    isCompliant: device.isCompliant ?? null,
    isManaged: device.isManaged ?? null,
    trustType: device.trustType ?? null,
    profileType: device.profileType ?? null,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
    approximateLastSignInDateTime: device.approximateLastSignInDateTime ?? null,
    registrationDateTime: device.registrationDateTime ?? null,
  }
}
