import { DATAVERSE_RESOURCE_URL } from '@/lib/oauth/dataverse'
import { resolveResourceOrigin } from '@/lib/oauth/resource-url'

/**
 * Normalizes a Dataverse environment URL into a base URL suitable for building Web API request
 * paths, so callers can safely append `/api/data/v9.2/...`.
 *
 * The value is user-supplied and every request built from it carries the caller's OAuth bearer
 * token, so the host is pinned to Microsoft's Dataverse domains — an arbitrary origin here would
 * otherwise receive that token. The same pinning decides the OAuth scope's audience at connect
 * time, which is why both read one {@link DATAVERSE_RESOURCE_URL} rather than their own host list.
 *
 * @throws {Error} when the value is empty, not a parseable URL, not HTTPS, carries credentials,
 *   or is not a Dataverse host.
 */
export function getDataverseBaseUrl(environmentUrl: string): string {
  const resolved = resolveResourceOrigin(environmentUrl, DATAVERSE_RESOURCE_URL)
  if (!resolved.ok) {
    throw new Error(resolved.error)
  }
  return resolved.origin
}
