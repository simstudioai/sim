import { sha256Hex } from '@sim/security/hash'
import { env } from '@/lib/core/config/env'

/** Deployment-owned credentials; callers apply Search availability separately. */
export function getSharedSlackSearchAppConfiguration(appId?: string) {
  const id = env.SLACK_SEARCH_APP_ID
  if (!id || (appId !== undefined && appId !== id)) return null
  const clientId = env.SLACK_SEARCH_CLIENT_ID
  const clientSecret = env.SLACK_SEARCH_CLIENT_SECRET
  const signingSecret = env.SLACK_SEARCH_SIGNING_SECRET
  if (!/^A[A-Z0-9]{1,199}$/.test(id) || !clientId || !clientSecret || !signingSecret)
    throw new Error(
      'Configure SLACK_SEARCH_APP_ID, SLACK_SEARCH_CLIENT_ID, SLACK_SEARCH_CLIENT_SECRET, and SLACK_SEARCH_SIGNING_SECRET for the shared Slack app'
    )
  return {
    id,
    kind: 'shared' as const,
    organizationId: null,
    clientId,
    clientSecret,
    signingSecret,
    revision: sha256Hex(JSON.stringify([id, clientId, clientSecret, signingSecret])),
  }
}
