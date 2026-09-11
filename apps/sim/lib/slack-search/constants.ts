export const SLACK_SEARCH_SCOPES = [
  'assistant:write',
  'chat:write',
  'im:history',
  'im:write',
  'app_mentions:read',
  'users:read',
  'users:read.email',
] as const
export const SLACK_SHARED_SEARCH_BOT_SCOPES = [...SLACK_SEARCH_SCOPES, 'commands'] as const
export const SLACK_SEARCH_MAX_DURATION_SECONDS = 180
export const SLACK_SEARCH_CONCURRENCY = 2
export const SLACK_SEARCH_MAX_PENDING_TURNS = 20
export const SLACK_SEARCH_FAILED_ANSWER = 'I couldn’t complete this search. Please try again.'
export const SLACK_SEARCH_QUERY_TOO_LONG =
  'Please shorten your question to 2,000 characters or fewer and send it again.'
