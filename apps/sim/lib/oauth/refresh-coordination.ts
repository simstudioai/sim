import { createHmac } from 'crypto'
import { env } from '@/lib/core/config/env'
import { clearDeadFlag } from '@/lib/oauth/terminal-errors'

/**
 * Returns the private identity shared by OAuth refresh locks and terminal-error
 * flags. Callers choose the semantic scope: an account row for ordinary OAuth,
 * or `slack:${teamId}` for a Slack installation.
 */
export function getOAuthRefreshCoordinationIdentity(scopeKey: string): string {
  return createHmac('sha256', env.ENCRYPTION_KEY)
    .update('oauth-refresh')
    .update('\0')
    .update(scopeKey)
    .digest('base64url')
}

/** Clears the terminal-error flag written by the refresh path for one raw scope. */
export function clearOAuthRefreshDeadFlag(scopeKey: string): Promise<void> {
  return clearDeadFlag(getOAuthRefreshCoordinationIdentity(scopeKey))
}
