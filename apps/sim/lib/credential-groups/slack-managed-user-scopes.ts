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
] as const

export const SLACK_SEARCH_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'users:read',
  'users:read.email',
] as const

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
