/**
 * Creates a Basic Authentication header for Workday ISU credentials.
 * @param username Integration System User username
 * @param password Integration System User password
 * @returns Base64-encoded Basic Auth header value
 */
export function createWorkdayAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${credentials}`
}

/**
 * Builds a Workday REST API base URL from tenant URL and tenant name.
 * @param tenantUrl The Workday instance URL (e.g., https://wd5-impl-services1.workday.com)
 * @param tenant The tenant name
 * @returns Formatted base URL for API calls
 */
export function buildWorkdayBaseUrl(tenantUrl: string, tenant: string): string {
  const baseUrl = tenantUrl.replace(/\/$/, '')
  return `${baseUrl}/ccx/api/v1/${tenant}`
}
