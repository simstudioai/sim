import {
  fetchProvider,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

const AGENTS_URL = 'https://api.anthropic.com/v1/agents?limit=1'
const ANTHROPIC_VERSION = '2023-06-01'
const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01'

/**
 * Validates a Claude Platform API key by listing agents on the linked
 * Anthropic workspace. 401/403 mean the key was rejected; any other non-2xx
 * means Claude Platform is unavailable. The Managed Agents API has no
 * "who am I" endpoint, so the key's last four characters are used as a
 * human-distinguishable display name across multiple linked workspaces.
 */
export async function validateClaudePlatformServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const res = await fetchProvider(
    AGENTS_URL,
    {
      headers: {
        'x-api-key': fields.apiToken,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': MANAGED_AGENTS_BETA,
      },
    },
    'agents_list'
  )
  await throwForProviderResponse(res, 'agents_list')

  const suffix = fields.apiToken.slice(-4)
  return {
    displayName: `Claude Platform (…${suffix})`,
    auditMetadata: {},
  }
}
