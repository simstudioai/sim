import { userPrincipal } from '@/lib/credentials/principal'
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
import { CODA_API_BASE, codaHeaders } from '@/tools/coda/utils'

const CODA_WHOAMI_URL = `${CODA_API_BASE}/whoami`

interface CodaWhoamiResponse {
  name?: string
  loginId?: string
  tokenName?: string
  scoped?: boolean
  workspace?: { id?: string; name?: string }
}

/**
 * Validates a Coda API token by calling `GET /whoami`, which every token may
 * call regardless of doc or table restrictions. The header set comes from the
 * same helper the runtime tools use, so a token that verifies here is proven
 * against the exact request shape tools send. Coda exposes no numeric user id,
 * so the login email is the principal id.
 */
export async function validateCodaServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    CODA_WHOAMI_URL,
    { headers: codaHeaders(fields.apiToken), redirect: 'error' },
    'whoami'
  )
  await throwForProviderResponse(res, 'whoami')

  const body = await parseProviderJson<CodaWhoamiResponse>(res, 'whoami')
  if (!body.loginId) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'whoami',
      reason: 'missing loginId in response',
    })
  }

  const auditMetadata: Record<string, string> = {}
  const storedMetadata: Record<string, string> = {}
  if (body.workspace?.id) {
    auditMetadata.codaWorkspaceId = body.workspace.id
    storedMetadata.workspaceId = body.workspace.id
  }
  if (typeof body.scoped === 'boolean') storedMetadata.scoped = String(body.scoped)
  if (body.tokenName) storedMetadata.tokenName = body.tokenName

  return {
    displayName: body.tokenName ? `${body.tokenName} (${body.loginId})` : body.loginId,
    principal: userPrincipal(body.loginId, body.name),
    auditMetadata,
    storedMetadata,
  }
}
