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
