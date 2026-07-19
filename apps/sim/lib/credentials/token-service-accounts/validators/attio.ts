import {
  fetchProvider,
  parseProviderJson,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const ATTIO_SELF_URL = 'https://api.attio.com/v2/self'

interface AttioSelfResponse {
  active?: boolean
  workspace_id?: string
  workspace_name?: string
  workspace_slug?: string
}

/**
 * Validates an Attio workspace access token against the identify endpoint
 * (`GET /v2/self`). Attio returns a minimal `{ active: false }` body for a
 * revoked/deleted token, so a 2xx alone is never trusted — the body must
 * assert `active === true` and carry the workspace identifiers. Attio replies
 * HTTP 400 ("Token was not recognised") for a malformed pasted key; since the
 * request carries no user input besides the bearer token, a 400 here is
 * treated as `invalid_credentials` rather than a provider fault.
 */
export async function validateAttioServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    ATTIO_SELF_URL,
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        Accept: 'application/json',
      },
    },
    'self'
  )
  if (res.status === 400) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'self',
      reason: 'token was not recognised (HTTP 400)',
    })
  }
  await throwForProviderResponse(res, 'self')

  const self = await parseProviderJson<AttioSelfResponse | null>(res, 'self')
  if (typeof self !== 'object' || self === null) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'self',
      reason: 'non-object response body',
    })
  }

  if (self.active === false) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'self',
      reason: 'token is revoked (active === false)',
    })
  }
  if (self.active !== true || !self.workspace_id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'self',
      reason: 'response missing active flag or workspace_id',
    })
  }

  const storedMetadata: Record<string, string> = { workspaceId: self.workspace_id }
  if (self.workspace_slug) {
    storedMetadata.workspaceSlug = self.workspace_slug
  }

  return {
    displayName: self.workspace_name || 'Attio workspace',
    auditMetadata: { attioWorkspaceId: self.workspace_id },
    storedMetadata,
  }
}
