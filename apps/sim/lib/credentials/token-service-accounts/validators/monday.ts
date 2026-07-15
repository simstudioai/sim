import {
  throwForProviderResponse,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { MONDAY_API_URL, mondayHeaders } from '@/tools/monday/utils'

const VALIDATION_QUERY = 'query { me { id name email } account { id name slug } }'

interface MondayValidationBody {
  data?: {
    me?: { id?: string | number; name?: string; email?: string }
    account?: { id?: string | number; name?: string; slug?: string }
  }
  errors?: Array<{ message?: string }>
  error_message?: string
}

/**
 * Mirrors `extractMondayError` from `@/tools/monday/utils`: monday returns
 * HTTP 200 for application-level failures, signalled by a GraphQL `errors`
 * array or a top-level `error_message` field.
 */
function extractBodyError(body: MondayValidationBody): string | null {
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const messages = body.errors.map((e) => e.message).filter(Boolean)
    return messages.length > 0 ? messages.join('; ') : 'Unknown Monday.com API error'
  }
  if (body.error_message) {
    return body.error_message
  }
  return null
}

/**
 * Validates a monday.com personal API token by running a `me`/`account`
 * GraphQL query. monday tools send the token as a bare `Authorization`
 * header (no `Bearer` prefix) with a pinned `API-Version`, so validation
 * reuses `mondayHeaders` to exercise exactly the shape tools use.
 *
 * monday returns HTTP 200 for application-level errors, so a 200 response
 * is only a success once the body carries no `errors` array or
 * `error_message` and `data.me.id` is present.
 */
export async function validateMondayServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: mondayHeaders(fields.apiToken),
    body: JSON.stringify({ query: VALIDATION_QUERY }),
  })
  await throwForProviderResponse(res, 'me')

  let body: MondayValidationBody
  try {
    body = (await res.json()) as MondayValidationBody
  } catch {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'me',
      reason: 'non-JSON response body',
    })
  }

  const bodyError = extractBodyError(body)
  if (bodyError) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step: 'me',
      body: bodyError,
    })
  }

  const me = body.data?.me
  const account = body.data?.account
  if (!me?.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'me',
      reason: 'missing me.id in response',
    })
  }

  const userId = String(me.id)
  const accountId = account?.id != null ? String(account.id) : ''
  const storedMetadata: Record<string, string> = { accountId, userId }
  if (account?.slug) {
    storedMetadata.accountSlug = account.slug
  }

  return {
    displayName: account?.name || me.name || me.email || `monday user ${userId}`,
    auditMetadata: { mondayAccountId: accountId },
    storedMetadata,
  }
}
