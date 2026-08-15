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
