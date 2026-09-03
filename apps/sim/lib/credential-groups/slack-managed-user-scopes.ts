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
  /**
   * Federated Slack search (`assistant.search.context`). Slack requires at
   * least `search:read.public`; each other scope widens what the search covers,
   * and the four together let a person's own search reach exactly the
   * conversations they can already read in Slack. `search:read.files` and
   * `search:read.users` are deliberately absent: this searches messages, and an
   * unused scope is one more thing every member is asked to grant.
   *
   * https://docs.slack.dev/ai/using-data-access-api
   */
  'search:read.public',
  'search:read.private',
  'search:read.im',
  'search:read.mpim',
  'users.profile:read',
  'users.profile:write',
  'users:read',
  'users:read.email',
] as const

export const SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH =
  '/api/credential-groups/slack-managed-users/callback'

export const SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH =
  '/api/credential-groups/oauth/slack/callback'
