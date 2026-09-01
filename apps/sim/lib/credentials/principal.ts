/**
 * Provider-identity primitives for service-account credentials.
 *
 * Deliberately a leaf module: the token and client-credential registries both
 * need these, and `service-account-secret` imports values from both registries.
 * Defining them there would close a runtime import cycle.
 */

/**
 * Provider identity captured while verifying a service-account credential.
 *
 * `tenant` exists because several providers can only ever report an
 * org/workspace/site-level identifier (Attio, Shopify, Webflow, Zoom, Zoho
 * Desk) — callers must never present those as the human actor behind the
 * credential. `lookup_failed` records that the provider does expose a
 * principal but the lookup did not complete, which is distinct from a
 * provider that exposes no principal at all (`null`).
 */
export type ServiceAccountPrincipal =
  | { kind: 'user'; id: string; label?: string }
  | { kind: 'tenant'; id: string; label?: string }
  | { kind: 'lookup_failed'; reason: string }

/**
 * The human actor a credential authenticates as.
 *
 * `label` accepts null/undefined because provider payloads routinely type an
 * optional email or username that way, and is dropped when empty so
 * {@link serviceAccountPrincipalMetadata} never emits a blank key.
 */
export function userPrincipal(id: string, label?: string | null): ServiceAccountPrincipal {
  return { kind: 'user', id, ...(label ? { label } : {}) }
}

/**
 * An org/workspace/site-level identifier, for the providers that expose no
 * actor at all. Kept distinct from {@link userPrincipal} so callers can never
 * present a tenant id as the person behind the credential.
 */
export function tenantPrincipal(id: string, label?: string | null): ServiceAccountPrincipal {
  return { kind: 'tenant', id, ...(label ? { label } : {}) }
}

/**
 * Flattens a principal into the string map mirrored into both `auditMetadata`
 * (queryable on `audit_log.metadata`) and `storedMetadata` (inside the
 * encrypted blob). Applied centrally by the builders below so no provider can
 * capture a principal and forget to surface it.
 */
export function serviceAccountPrincipalMetadata(
  principal: ServiceAccountPrincipal | null
): Record<string, string> {
  if (principal === null) return { principalKind: 'none' }
  if (principal.kind === 'lookup_failed') {
    return { principalKind: 'lookup_failed', principalLookupError: principal.reason }
  }
  return {
    principalKind: principal.kind,
    principalId: principal.id,
    ...(principal.label ? { principalLabel: principal.label } : {}),
  }
}
