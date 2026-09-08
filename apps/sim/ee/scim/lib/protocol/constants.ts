/** Schema URNs, media types, and limits fixed by RFC 7643 and RFC 7644. */

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const SCIM_ENTERPRISE_USER_SCHEMA =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType'
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema'

/** SCIM's own media type, plus the plain JSON every provider also sends. */
export const SCIM_MEDIA_TYPE = 'application/scim+json'
export const SCIM_ACCEPTED_MEDIA_TYPES = [SCIM_MEDIA_TYPE, 'application/json'] as const

/** The mount point every `meta.location` and `$ref` is built from. */
export const SCIM_BASE_PATH = '/api/scim/v2'

/**
 * Largest page a list response returns, and the default when a provider asks
 * for none. Okta imports with `count=100`; advertising a ceiling above what the
 * providers use would only invite a request we would rather not serve in one
 * transaction.
 */
export const SCIM_MAX_PAGE_SIZE = 100

/** Largest membership a single Group may carry. */
export const SCIM_MAX_GROUP_MEMBERS = 5000

/** Largest number of `and`-joined terms accepted in one filter. */
export const SCIM_MAX_FILTER_TERMS = 10

/** Largest number of operations accepted in one PATCH request. */
export const SCIM_MAX_PATCH_OPERATIONS = 100

/** Largest request body accepted, sized for a full-membership Group write. */
export const SCIM_MAX_BODY_BYTES = 1_000_000

/**
 * Requests a connection may make per minute, and the burst it may spend at once.
 *
 * Microsoft requires a SCIM endpoint to sustain at least 25 requests per second
 * per tenant, and opens each provisioning cycle with a burst of reads; Okta pages
 * imports at 100 users a call. The bucket is sized to those clients, not to
 * interactive traffic.
 */
export const SCIM_RATE_LIMIT = {
  maxTokens: 3_000,
  refillRate: 1_500,
  refillIntervalMs: 60_000,
} as const

/** Request-log rows kept per connection; the reconcile job prunes the rest. */
export const SCIM_REQUEST_LOG_RETENTION = 500
