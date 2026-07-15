import {
  fetchProvider,
  parseProviderJson,
  throwForProviderResponse,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

/**
 * Pinned to the same API version Sim's Notion tools send
 * (`apps/sim/tools/notion/read.ts`) so validation and execution exercise the
 * same API surface.
 */
const NOTION_VERSION = '2022-06-28'

interface NotionBotUser {
  id?: string
  name?: string | null
  bot?: {
    workspace_name?: string | null
  }
}

/**
 * Validates a Notion internal integration secret by calling
 * `GET /v1/users/me`, which is documented to succeed with any capability
 * level. Tokens are treated as opaque strings — Notion explicitly advises
 * against prefix/regex validation (`ntn_` and legacy `secret_` are both
 * valid).
 */
export async function validateNotionServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    'https://api.notion.com/v1/users/me',
    {
      headers: {
        Authorization: `Bearer ${fields.apiToken}`,
        'Notion-Version': NOTION_VERSION,
        Accept: 'application/json',
      },
    },
    'users_me'
  )
  await throwForProviderResponse(res, 'users_me')

  const me = await parseProviderJson<NotionBotUser>(res, 'users_me')
  if (!me.id) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'users_me',
      reason: 'missing id in response',
    })
  }

  const workspaceName = me.bot?.workspace_name || undefined
  const storedMetadata: Record<string, string> = { botId: me.id }
  if (workspaceName) {
    storedMetadata.workspaceName = workspaceName
  }

  return {
    displayName: me.name || workspaceName || 'Notion integration',
    auditMetadata: { notionBotId: me.id },
    storedMetadata,
  }
}
