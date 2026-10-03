import { SLACK_RTS_USER_SCOPES } from '@/lib/sim-search/live/scopes'

/**
 * User-token policy requested and verified by Credential Group Slack OAuth.
 * This is independent of the custom bot manifest and its configuration UI.
 */
export const SLACK_MANAGED_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'channels:write',
  'canvases:read',
  'canvases:write',
  'chat:write',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'reactions:read',
  'reactions:write',
  'users.profile:read',
  'users.profile:write',
  'users:read',
  'users:read.email',
  'bookmarks:read',
  'bookmarks:write',
  'dnd:read',
  'emoji:read',
  'links:write',
  'pins:read',
  'pins:write',
  'team:read',
  'usergroups:read',
  'usergroups:write',
  'users:write',
] as const

export const SLACK_CHANNEL_READ_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
] as const

export const SLACK_DM_READ_SCOPES = ['im:history', 'im:read', 'mpim:history', 'mpim:read'] as const

/** Explicit Search setup grants channel, DM, and live retrieval permissions together. */
export const SLACK_SEARCH_USER_SCOPES = [
  ...SLACK_CHANNEL_READ_SCOPES,
  ...SLACK_DM_READ_SCOPES,
  'users:read',
  'users:read.email',
  ...SLACK_RTS_USER_SCOPES,
] as const

/** Search readiness is separate from a connection's existing workflow permissions. */
export function hasSlackSearchUserScopes(scopes: readonly string[] | undefined): boolean {
  return SLACK_SEARCH_USER_SCOPES.every((scope) => scopes?.includes(scope))
}

/** Existing workflow options retain their scope policy; every user grant must attest identity. */
export function resolveSlackManagedUserScopes(requiredScopes?: readonly string[]): string[] {
  return [
    ...new Set([
      ...(requiredScopes?.length ? requiredScopes : SLACK_MANAGED_USER_SCOPES),
      'users:read',
      'users:read.email',
    ]),
  ]
}

export const SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH =
  '/api/credential-groups/slack-managed-users/callback'

export const SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH =
  '/api/credential-groups/oauth/slack/callback'
