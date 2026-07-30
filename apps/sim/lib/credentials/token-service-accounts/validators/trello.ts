import { env } from '@/lib/core/config/env'
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

const MEMBERS_ME_URL = 'https://api.trello.com/1/members/me'

interface TrelloMember {
  id?: string
  fullName?: string
  username?: string
}

/**
 * Validates a Trello member token by calling `/1/members/me` with the token
 * paired against Sim's own `TRELLO_API_KEY` — Trello binds tokens to the API
 * key that authorized them, so a token minted under any other key 401s here
 * exactly as it would at execution time. Both secrets travel as URL query
 * params, so no request URL is ever included in error `logDetail` (only the
 * step name and a body snippet, which never echoes the credentials). A 401 is
 * disambiguated by body: Trello's `invalid key` means Sim's own key was
 * rejected (`provider_unavailable`), while `invalid token` — or any other 401
 * body — blames the pasted token (`invalid_credentials`).
 */
export async function validateTrelloServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const apiKey = env.TRELLO_API_KEY
  if (!apiKey) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 500, {
      reason: 'Trello API key is not configured',
    })
  }

  const url = new URL(MEMBERS_ME_URL)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('token', fields.apiToken)
  url.searchParams.set('fields', 'id,fullName,username')

  const res = await fetchProvider(
    url.toString(),
    { headers: { Accept: 'application/json' } },
    'members_me'
  )
  if (res.status === 401) {
    const body = await readProviderErrorSnippet(res)
    if (body.includes('invalid token')) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 401, {
        step: 'members_me',
        body,
      })
    }
    if (body.includes('invalid key')) {
      throw new TokenServiceAccountValidationError('provider_unavailable', 401, {
        step: 'members_me',
        reason: 'Trello rejected the server API key',
      })
    }
    throw new TokenServiceAccountValidationError('invalid_credentials', 401, {
      step: 'members_me',
      body,
    })
  }
  await throwForProviderResponse(res, 'members_me')

  const member = await parseProviderJson<TrelloMember>(res, 'members_me')
  if (typeof member?.id !== 'string' || !member.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'members_me',
      reason: 'missing id in response',
    })
  }

  const storedMetadata: Record<string, string> = { memberId: member.id }
  if (typeof member.username === 'string' && member.username) {
    storedMetadata.username = member.username
  }

  return {
    displayName: member.fullName || member.username || `Trello member ${member.id}`,
    auditMetadata: { trelloMemberId: member.id },
    storedMetadata,
  }
}
