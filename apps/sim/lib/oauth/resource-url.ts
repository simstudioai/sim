import type { OAuthResourceUrlConfig } from '@/lib/oauth/types'

/**
 * Outcome of validating a user-supplied resource URL. Modeled as a result
 * rather than a throw because the connect modal validates on every keystroke,
 * where an exception would be control flow rather than an error.
 */
export type ResourceOriginResult = { ok: true; origin: string } | { ok: false; error: string }

/**
 * Normalizes a user-supplied resource URL to a bare `https://host` origin and
 * checks it against the service's allowed hosts.
 *
 * The origin ends up inside an OAuth scope, so an unchecked value would let a
 * connect attempt request a token audience of the submitter's choosing. Hosts
 * are matched on the registrable domain rather than each regional prefix, so a
 * new provider region keeps working without a code change.
 */
export function resolveResourceOrigin(
  raw: string | undefined,
  config: OAuthResourceUrlConfig
): ResourceOriginResult {
  const value = (raw ?? '').trim()
  if (!value) {
    return { ok: false, error: `${config.title} is required` }
  }

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { ok: false, error: `${config.title} must be a valid URL, e.g. ${config.placeholder}` }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `${config.title} must use https` }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: `${config.title} must not contain credentials` }
  }
  /**
   * `URL` drops the port only when it is the scheme default, so anything left
   * here is explicit. The origin becomes an OAuth audience and the base for
   * every API request, and providers publish their resource on the default
   * port — a port-qualified origin would be a resource nobody serves.
   */
  if (parsed.port) {
    return { ok: false, error: `${config.title} must not include a port` }
  }

  /**
   * The allowlist is the whole security control here: no private address,
   * loopback host, or internal name can end with one of these public registrable
   * domains, so a separate SSRF check would add nothing.
   */
  const hostname = parsed.hostname.toLowerCase()
  if (!config.allowedHostSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, error: `${config.title} must be a valid URL, e.g. ${config.placeholder}` }
  }

  return { ok: true, origin: parsed.origin }
}

/**
 * Recovers the tenant origin a credential's token is an audience for, by finding
 * the resource scope among the scopes actually granted.
 *
 * The origin is already recorded there by the connect flow, so it is read back
 * rather than stored a second time or asked of the user again. This is also the
 * completeness check for such a credential: a resource-scoped service whose
 * granted scopes name no valid host holds a token no API will accept, which is
 * otherwise invisible until a request returns 401.
 */
export function findGrantedResourceOrigin(
  scopes: readonly string[] | undefined,
  config: OAuthResourceUrlConfig
): string | undefined {
  for (const scope of scopes ?? []) {
    if (!scope.endsWith(config.scopeSuffix)) continue
    const resolved = resolveResourceOrigin(scope.slice(0, -config.scopeSuffix.length), config)
    if (resolved.ok) return resolved.origin
  }
  return undefined
}
