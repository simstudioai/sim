/**
 * Normalizes a Dataverse environment URL into a base URL suitable for building Web API request
 * paths: trims incidental whitespace (common when pasted from a browser address bar) and strips
 * a trailing slash so callers can safely append `/api/data/v9.2/...`.
 */
export function getDataverseBaseUrl(environmentUrl: string): string {
  return environmentUrl.trim().replace(/\/$/, '')
}
