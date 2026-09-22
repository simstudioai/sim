/** User-token RTS permissions. Existing grant policies remain valid when switching back to indexed search. */
export const SLACK_RTS_USER_SCOPES = [
  'search:read.files',
  'files:read',
  'search:read.public',
  'search:read.private',
  'search:read.mpim',
  'search:read.im',
] as const
