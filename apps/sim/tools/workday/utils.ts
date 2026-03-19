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
 * Builds a Workday REST API base URL.
 * REST pattern: {tenantUrl}/api/v1/{tenant}
 * @param tenantUrl The Workday instance URL (e.g., https://wd2-impl-services1.workday.com)
 * @param tenant The tenant name
 */
export function buildWorkdayRestUrl(tenantUrl: string, tenant: string): string {
  const baseUrl = tenantUrl.replace(/\/$/, '')
  return `${baseUrl}/api/v1/${tenant}`
}

/**
 * Builds a Workday SOAP/WS API base URL.
 * SOAP pattern: {tenantUrl}/ccx/service/{tenant}/{serviceName}/{version}
 * Used for operations not available via REST (hire, terminate, etc.).
 * @param tenantUrl The Workday instance URL
 * @param tenant The tenant name
 * @param serviceName The WS service name (e.g., Staffing, Human_Resources)
 * @param version The API version (e.g., v42.0, v45.0)
 */
export function buildWorkdaySoapUrl(
  tenantUrl: string,
  tenant: string,
  serviceName: string,
  version: string
): string {
  const baseUrl = tenantUrl.replace(/\/$/, '')
  return `${baseUrl}/ccx/service/${tenant}/${serviceName}/${version}`
}
