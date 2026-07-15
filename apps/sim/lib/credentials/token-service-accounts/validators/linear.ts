import {
  TokenServiceAccountValidationError,
  readProviderErrorSnippet,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

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
 */
function hasAuthenticationError(errors: LinearGraphQLError[] | undefined): boolean {
  if (!errors) return false
  return errors.some((error) => {
    const haystack = [error.message, error.extensions?.code, error.extensions?.type]
    return haystack.some((value) => typeof value === 'string' && /authentication/i.test(value))
  })
}

/**
 * Validates a Linear personal API key by running the `viewer` query against
 * the fixed GraphQL endpoint. Personal keys are sent as a bare
 * `Authorization: <key>` header — no `Bearer` prefix — per Linear's official
 * docs (the Bearer form is reserved for OAuth access tokens). GraphQL can
 * return transport 200 with an `errors` array, so both the HTTP status and
 * the body are inspected.
 */
export async function validateLinearServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: fields.apiToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: VIEWER_QUERY }),
  })

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status === 400 || res.status === 401 || res.status === 403) {
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

  const payload = (await res.json()) as LinearViewerResponse
  if (hasAuthenticationError(payload.errors)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'viewer',
      reason: 'GraphQL authentication error in 200 response',
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
