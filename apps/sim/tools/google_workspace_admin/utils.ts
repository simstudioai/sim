/** Base URL of the Admin SDK Directory API. */
export const DIRECTORY_API_BASE = 'https://admin.googleapis.com/admin/directory/v1'

/** Base URL of the Admin SDK Reports API. */
export const REPORTS_API_BASE = 'https://admin.googleapis.com/admin/reports/v1'

/**
 * Alias the Admin SDK accepts in place of the account's customer ID. Every
 * customer-scoped endpoint falls back to it so an operator never has to look
 * their customer ID up for the common single-tenant case.
 */
export const DEFAULT_CUSTOMER = 'my_customer'

/** Builds the shared Authorization/Content-Type headers for an Admin SDK call. */
export function adminHeaders(params: { accessToken: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Appends the defined query parameters to a URL, skipping anything the caller
 * left blank so the Admin SDK applies its own documented defaults.
 */
export function appendQueryParams(
  url: URL,
  params: Record<string, string | number | boolean | undefined>
): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
}

/**
 * Encodes an org unit path for the Directory API's `{orgUnitPath=**}` wildcard
 * path segment. The API expects the path without its leading slash and with the
 * separating slashes left intact, so each segment is encoded individually. A
 * unique `orgUnitId` (which carries no slashes) passes through unchanged.
 */
export function encodeOrgUnitPath(orgUnitPath: string): string {
  return orgUnitPath
    .replace(/^\//, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * Maximum devices the Admin SDK accepts in one
 * `customer.devices.chromeos:batchChangeStatus` call.
 */
const MAX_BATCH_DEVICE_IDS = 50

/**
 * Splits a comma-separated ChromeOS device ID list into the array the batch
 * status endpoint expects, rejecting an empty or over-long list up front so the
 * caller gets a precise message instead of a generic 400.
 */
export function parseDeviceIds(deviceIds: string): string[] {
  const ids = deviceIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  if (ids.length === 0) {
    throw new Error('At least one ChromeOS device ID is required')
  }
  if (ids.length > MAX_BATCH_DEVICE_IDS) {
    throw new Error(
      `Google Workspace accepts at most ${MAX_BATCH_DEVICE_IDS} ChromeOS device IDs per batch, received ${ids.length}`
    )
  }
  return ids
}

/**
 * Enum values the Directory API discovery document declares, spelled exactly as
 * each endpoint expects. The casing is not consistent across resources — the
 * `users` collection is camelCase and lowercase while the device collections
 * are SCREAMING_SNAKE — so each set is kept separate rather than shared.
 */
export const USER_ORDER_BY = ['email', 'familyName', 'givenName'] as const
export const USER_PROJECTION = ['basic', 'custom', 'full'] as const
export const USER_VIEW_TYPE = ['admin_view', 'domain_public'] as const
export const ORG_UNIT_LIST_TYPE = ['all', 'children', 'allIncludingParent'] as const
export const CHROMEOS_ORDER_BY = [
  'annotatedLocation',
  'annotatedUser',
  'lastSync',
  'notes',
  'serialNumber',
  'status',
] as const
export const MOBILE_ORDER_BY = [
  'deviceId',
  'email',
  'lastSync',
  'model',
  'name',
  'os',
  'status',
  'type',
] as const
export const DEVICE_PROJECTION = ['BASIC', 'FULL'] as const
export const SORT_ORDER = ['ASCENDING', 'DESCENDING'] as const

/**
 * Resolves a caller-supplied enum value to the exact spelling the Admin SDK
 * declares for that parameter.
 *
 * Google mixes conventions across the Directory API: `users.list` accepts
 * `familyName` and `basic`, while `chromeosdevices.list` accepts `SERIAL_NUMBER`
 * and `BASIC`. Matching case-insensitively and ignoring underscores lets a
 * caller write either style and still reach the API with the spelling that
 * endpoint requires, instead of a 400 `Invalid Value`. An unrecognized value is
 * rejected here so the caller sees the allowed set rather than a generic error.
 */
export function normalizeEnumValue<T extends string>(
  paramName: string,
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined || value === '') return undefined
  const compact = (input: string) => input.replace(/_/g, '').toLowerCase()
  const target = compact(value)
  const match = allowed.find((option) => compact(option) === target)
  if (!match) {
    throw new Error(`${paramName} must be one of ${allowed.join(', ')} — received "${value}"`)
  }
  return match
}

/** Extracts the Admin SDK's `error.message` from an error payload. */
function extractAdminError(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const error = (data as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

/** Reads a JSON body, throwing the Admin SDK error message on a failed call. */
export async function readAdminJson<T>(response: Response, failureMessage: string): Promise<T> {
  const data: unknown = await response.json()
  if (!response.ok) {
    throw new Error(extractAdminError(data) ?? failureMessage)
  }
  return data as T
}

/**
 * Asserts success for an endpoint the Admin SDK documents as returning an empty
 * body. The response is only parsed on failure, where an error payload exists.
 */
export async function assertAdminSuccess(
  response: Response,
  failureMessage: string
): Promise<void> {
  if (response.ok) return
  const data: unknown = await response.json().catch(() => null)
  throw new Error(extractAdminError(data) ?? failureMessage)
}
