import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { clickupAuthorizationHeader } from '@/tools/clickup/shared'

const CLICKUP_USER_URL = 'https://api.clickup.com/api/v2/user'

interface ClickUpUserResponse {
  user?: {
    id?: number
    username?: string | null
    email?: string | null
  }
}

/**
 * Validates a ClickUp personal API token by fetching the authorized user. The
 * Authorization header is built with the same helper the runtime tools use
 * (`clickupAuthorizationHeader`): personal `pk_` tokens go bare, anything else
 * gets the `Bearer` prefix — so validation exercises the exact header shape
 * tools will send.
 */
export async function validateClickupServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    CLICKUP_USER_URL,
    {
      method: 'GET',
      headers: {
        Authorization: clickupAuthorizationHeader(fields.apiToken),
        'Content-Type': 'application/json',
      },
    },
    'user'
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status === 401 || res.status === 403) {
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'user',
        body,
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: 'user',
      body,
    })
  }

  const payload = await parseProviderJson<ClickUpUserResponse>(res, 'user')
  const user = payload.user
  if (!user?.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'user',
      reason: 'missing user in response',
    })
  }

  return {
    displayName: user.username || user.email || 'ClickUp account',
    auditMetadata: { clickupUserId: String(user.id) },
    storedMetadata: { userId: String(user.id) },
  }
}
