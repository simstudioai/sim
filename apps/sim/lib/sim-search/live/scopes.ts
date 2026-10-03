/** User-token permissions required by Slack's live retrieval API. */
export const SLACK_RTS_USER_SCOPES = [
  'search:read.files',
  'files:read',
  'search:read.public',
  'search:read.private',
  'search:read.mpim',
  'search:read.im',
] as const
