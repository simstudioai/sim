import { AsyncLocalStorage } from 'node:async_hooks'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError } from 'better-auth/api'
import { OAUTH_SEARCH_READ_SCOPE } from '@/lib/auth/oauth-provider'
import { getBaseUrl } from '@/lib/core/utils/urls'

interface OAuthResourceIssuance {
  requestedResource: string | null
  verifiedResource?: string | null
}

const issuance = new AsyncLocalStorage<OAuthResourceIssuance>()
const SEARCH_RESOURCE_PATH = /^\/api\/mcp\/search\/organizations\/[A-Za-z0-9_-]{1,128}$/

export class InvalidOAuthResourceError extends Error {
  constructor() {
    super('The resource must be a canonical Sim Search MCP URL.')
    this.name = 'InvalidOAuthResourceError'
  }
}

/** Accepts only organization Search MCP endpoints on this deployment's canonical origin. */
export function parseOAuthSearchResource(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    if (
      value.length > 2048 ||
      url.href !== value ||
      url.origin !== new URL(getBaseUrl()).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !SEARCH_RESOURCE_PATH.test(url.pathname)
    ) {
      throw new InvalidOAuthResourceError()
    }
    return value
  } catch {
    throw new InvalidOAuthResourceError()
  }
}

/** Keeps the token request audience isolated while Better Auth validates the authorization code. */
export function withOAuthResourceIssuance<T>(
  requestedResource: string | null,
  work: () => Promise<T>
): Promise<T> {
  return issuance.run({ requestedResource }, work)
}

/**
 * Runs after Better Auth verifies the code and PKCE, before it writes either token.
 * Its opaque-token path does not persist audiences, so only this verified context
 * may supply the resource stored by the guarded adapter.
 */
export function bindOAuthIssuedResource({
  verificationValue,
  scopes,
}: {
  verificationValue?: { query?: unknown }
  scopes: readonly string[]
}): Record<string, never> {
  const context = issuance.getStore()
  const query = verificationValue?.query
  const resourceValue =
    query && typeof query === 'object' && 'resource' in query ? query.resource : undefined
  let resource: string | null
  try {
    if (resourceValue !== undefined && typeof resourceValue !== 'string') {
      throw new InvalidOAuthResourceError()
    }
    resource = parseOAuthSearchResource(resourceValue ?? null)
  } catch {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_target',
      error_description: 'The authorization resource is invalid.',
    })
  }

  if (resource !== (context?.requestedResource ?? null)) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_target',
      error_description: 'The token resource must match the authorization request.',
    })
  }
  if (
    resource
      ? !scopes.includes(OAUTH_SEARCH_READ_SCOPE) ||
        scopes.some((scope) => scope !== OAUTH_SEARCH_READ_SCOPE && scope !== 'offline_access')
      : scopes.includes(OAUTH_SEARCH_READ_SCOPE)
  ) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_scope',
      error_description: 'Search access requires its matching resource and search scope.',
    })
  }
  if (resource && !context) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_target',
      error_description: 'Resource-bound issuance requires a token request.',
    })
  }
  if (context) context.verifiedResource = resource
  return {}
}

/** Refuses resource-bearing writes unless the validated authorization-code hook ran. */
export function getOAuthIssuedResource(scopes: readonly string[]): string | null {
  const context = issuance.getStore()
  if (
    (context?.requestedResource || scopes.includes(OAUTH_SEARCH_READ_SCOPE)) &&
    !context?.verifiedResource
  ) {
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_target',
      error_description: 'The token resource has not been authorized.',
    })
  }
  return context?.verifiedResource ?? null
}

/** Registers server-owned audience fields with Better Auth's adapter schema. */
export function oauthResourcePlugin() {
  return {
    id: 'sim-oauth-resources',
    schema: {
      oauthAccessToken: {
        fields: { resource: { type: 'string', required: false, input: false, returned: false } },
      },
      oauthRefreshToken: {
        fields: { resource: { type: 'string', required: false, input: false, returned: false } },
      },
    },
  } satisfies BetterAuthPlugin
}
