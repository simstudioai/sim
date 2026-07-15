import {
  throwForProviderResponse,
  TokenServiceAccountValidationError,
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
 * assert `active === true` and carry the workspace identifiers.
 */
export async function validateAttioServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetch(ATTIO_SELF_URL, {
    headers: {
      Authorization: `Bearer ${fields.apiToken}`,
      Accept: 'application/json',
    },
  })
  await throwForProviderResponse(res, 'self')

  let self: AttioSelfResponse
  try {
    self = (await res.json()) as AttioSelfResponse
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'self',
      reason: 'non-JSON response body',
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
