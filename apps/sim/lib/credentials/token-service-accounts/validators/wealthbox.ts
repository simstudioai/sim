import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const ME_URL = 'https://api.crmworkspace.com/v1/me'

interface WealthboxMeResponse {
  name?: string
  email?: string
  current_user?: {
    id?: number
    email?: string
    name?: string
  }
}

/**
 * Best-effort probe with the officially documented `ACCESS_TOKEN` header.
 * Used only to distinguish "bogus token" from "real token that Wealthbox
 * refuses over Bearer" in server logs — never to accept the credential,
 * because Sim's Wealthbox tools send `Authorization: Bearer` at runtime.
 */
async function probeAccessTokenHeader(apiToken: string): Promise<boolean> {
  try {
    const res = await fetchProvider(
      ME_URL,
      { headers: { ACCESS_TOKEN: apiToken, Accept: 'application/json' } },
      'me-access-token-probe'
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * Validates a Wealthbox personal API access token by calling `GET /v1/me`
 * with `Authorization: Bearer` — the exact header shape Sim's Wealthbox tools
 * use — so a passing validation empirically proves the token works with the
 * existing tool code. If Bearer is rejected but the documented `ACCESS_TOKEN`
 * header succeeds, the token is real yet unusable by Sim's tools, so it is
 * still rejected as `invalid_credentials` with a distinguishing log detail.
 *
 * A 402 is documented by Wealthbox as "Wealthbox trial account has expired"
 * and maps to `invalid_credentials` — retrying later would never succeed, so
 * the user is prompted to check their Wealthbox account instead.
 */
export async function validateWealthboxServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const apiToken = fields.apiToken

  const res = await fetchProvider(
    ME_URL,
    { headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' } },
    'me'
  )

  if (res.status === 402) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'me',
      reason: 'wealthbox trial expired (402)',
    })
  }

  if (res.status === 401 || res.status === 403) {
    const body = await readProviderErrorSnippet(res)
    const accessTokenHeaderWorks = await probeAccessTokenHeader(apiToken)
    if (accessTokenHeaderWorks) {
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'me',
        body,
        reason: 'token accepted only via ACCESS_TOKEN header — not compatible with Sim tools',
      })
    }
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'me',
      body,
    })
  }
  await throwForProviderResponse(res, 'me')

  const me = await parseProviderJson<WealthboxMeResponse>(res, 'me')

  const displayName = me.name || me.email || 'Wealthbox account'
  const userId = typeof me.current_user?.id === 'number' ? String(me.current_user.id) : undefined
  const email = me.email || me.current_user?.email

  const auditMetadata: Record<string, string> = {}
  if (userId) auditMetadata.wealthboxUserId = userId

  const storedMetadata: Record<string, string> = {}
  if (userId) storedMetadata.userId = userId
  if (email) storedMetadata.email = email

  return { displayName, auditMetadata, storedMetadata }
}
