import {
  TokenServiceAccountValidationError,
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { linearAuthorizationHeader } from '@/tools/linear/utils'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

const VIEWER_QUERY = '{ viewer { id name email } organization { id name } }'

interface LinearGraphQLError {
  message?: string
  extensions?: {
    code?: string
    type?: string
  }
}

interface LinearViewerResponse {
  data?: {
    viewer?: {
      id?: string
      name?: string | null
      email?: string | null
    }
    organization?: {
      id?: string
      name?: string | null
    }
  }
  errors?: LinearGraphQLError[]
}

/**
 * Linear does not officially document the HTTP status or extension code for a
 * rejected key (community reports both 400 and 401, lowercase
 * `authentication_error` in either `extensions.code` or `extensions.type`),
 * so match "authentication" case-insensitively across message and extensions.
 * Forbidden-type errors (a permissions-scoped key that cannot read `viewer`)
 * are also treated as credential failures — such a key is unusable for Sim
 * tools.
 */
function hasCredentialError(errors: LinearGraphQLError[] | undefined): boolean {
  if (!errors) return false
  return errors.some((error) => {
    const haystack = [error.message, error.extensions?.code, error.extensions?.type]
    return haystack.some(
      (value) =>
        typeof value === 'string' && /authentication|forbidden|not.?authorized/i.test(value)
    )
  })
}

/**
 * Validates a Linear personal API key by running the `viewer` query against
 * the fixed GraphQL endpoint. The Authorization header is built with the same
 * helper the runtime tools use (`linearAuthorizationHeader`): personal
 * `lin_api_` keys go bare, anything else gets the `Bearer` prefix — so
 * validation exercises the exact header shape tools will send. GraphQL can
 * return transport 200 with an `errors` array, so both the HTTP status and
 * the body are inspected. Linear also returns HTTP 400 for rate/complexity
 * limits (`RATELIMITED`), so a 400 only maps to `invalid_credentials` when
 * the body carries authentication evidence.
 */
export async function validateLinearServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    LINEAR_GRAPHQL_URL,
    {
      method: 'POST',
      headers: {
        Authorization: linearAuthorizationHeader(fields.apiToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: VIEWER_QUERY }),
    },
    'viewer'
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status === 401 || res.status === 403) {
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'viewer',
        body,
      })
    }
    if (res.status === 400) {
      if (!/ratelimit|complexity/i.test(body) && /authenticat/i.test(body)) {
        throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
          step: 'viewer',
          body,
        })
      }
      throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
        step: 'viewer',
        body,
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: 'viewer',
      body,
    })
  }

  const payload = await parseProviderJson<LinearViewerResponse>(res, 'viewer')
  if (hasCredentialError(payload.errors)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'viewer',
      reason: 'GraphQL authentication/authorization error in 200 response',
    })
  }

  const viewer = payload.data?.viewer
  if (!viewer?.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'viewer',
      reason: 'missing viewer in response',
    })
  }

  const organization = payload.data?.organization
  const storedMetadata: Record<string, string> = { viewerId: viewer.id }
  const auditMetadata: Record<string, string> = {}
  if (organization?.id) {
    storedMetadata.organizationId = organization.id
    auditMetadata.linearOrganizationId = organization.id
  }

  return {
    displayName: organization?.name || viewer.name || viewer.email || 'Linear workspace',
    auditMetadata,
    storedMetadata,
  }
}
