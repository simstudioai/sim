import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getCredentialGroupProviderId } from '@/lib/credential-groups/providers'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  ManagedOAuthCredentialError,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import { searchSlack } from '@/lib/slack-search/client'
import { findViewerSlackCredentialId } from '@/lib/slack-search/credentials'
import type { SlackSearchResult } from '@/lib/slack-search/types'

const logger = createLogger('SlackSearch')

/**
 * The scopes a federated search needs. A credential granted before search was
 * added lacks them, and the mint refuses it as insufficiently scoped, which
 * reaches the person as `needs_reauth` — the honest answer, since reconnecting
 * is exactly what would fix it.
 */
const SLACK_SEARCH_SCOPES = SLACK_MANAGED_USER_SCOPES.filter((scope) =>
  scope.startsWith('search:read.')
)

/**
 * What a federated Slack leg produced. Failure is a state the surface shows
 * rather than an exception it propagates: a search covers knowledge bases too,
 * and Slack being unreachable must never cost the person those results.
 */
export type SlackSearchOutcome =
  | { status: 'ok'; results: SlackSearchResult[] }
  /** Nobody connected a Slack account for this person in this workspace. */
  | { status: 'not_connected' }
  /** They have one, but it must be authorized again before it can search. */
  | { status: 'needs_reauth' }
  /** Slack, or the credential behind it, could not answer this time. */
  | { status: 'unavailable' }

function outcomeForCredentialError(error: ManagedOAuthCredentialError): SlackSearchOutcome {
  switch (error.code) {
    case 'MANAGED_CREDENTIAL_NEEDS_REAUTH':
    case 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE':
    case 'MANAGED_CREDENTIAL_REVOKED':
      return { status: 'needs_reauth' }
    case 'MANAGED_CREDENTIAL_NOT_FOUND':
      return { status: 'not_connected' }
    default:
      return { status: 'unavailable' }
  }
}

export interface SearchSlackForViewerParams {
  workspaceId: string
  /** The person asking. Slack is searched as them, under their own token. */
  userId: string
  query: string
  limit?: number
  signal?: AbortSignal
}

/**
 * Searches Slack on behalf of the person asking, if they have connected it.
 *
 * Nothing is indexed and no permission is computed here: the search runs under
 * the person's own Slack token, so Slack returns exactly the conversations
 * they can already read and no more. That is why this needs no access scope,
 * no ACL, and no crawl.
 */
export async function searchSlackForViewer(
  params: SearchSlackForViewerParams
): Promise<SlackSearchOutcome> {
  let credentialId: string | null
  try {
    credentialId = await findViewerSlackCredentialId({
      workspaceId: params.workspaceId,
      userId: params.userId,
    })
  } catch (error) {
    logger.error('Failed to look up a Slack search credential', {
      error: getErrorMessage(error),
    })
    return { status: 'unavailable' }
  }
  if (!credentialId) return { status: 'not_connected' }

  let accessToken: string
  try {
    const resolved = await resolveManagedOAuthToken({
      credentialId,
      workspaceId: params.workspaceId,
      expectedProviderId: getCredentialGroupProviderId('slack'),
      requiredScopes: [...SLACK_SEARCH_SCOPES],
    })
    accessToken = resolved.accessToken
  } catch (error) {
    if (error instanceof ManagedOAuthCredentialError) {
      logger.info('Slack search credential unusable', { code: error.code })
      return outcomeForCredentialError(error)
    }
    logger.error('Failed to resolve a Slack search credential', {
      error: getErrorMessage(error),
    })
    return { status: 'unavailable' }
  }

  try {
    const results = await searchSlack({
      accessToken,
      query: params.query,
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    })
    return { status: 'ok', results }
  } catch (error) {
    logger.warn('Slack search failed', { error: getErrorMessage(error) })
    return { status: 'unavailable' }
  }
}
