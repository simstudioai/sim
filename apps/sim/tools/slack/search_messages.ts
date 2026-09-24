import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { messageSearchOutput, messageSearchSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/search.messages/ */
export const slackSearchMessagesTool = createSlackWebApiTool({
  id: 'slack_search_messages',
  name: 'Slack Search Messages',
  description:
    'Search messages visible to the authorized Slack user. Requires a managed user credential with search:read. Continue using messages.paging.',
  endpoint: 'search.messages',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['search:read'],
    credentialKind: 'oauth',
  },
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search Query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort By Options: score, timestamp.',
    },
    sort_dir: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort Direction Options: asc, desc.',
    },
    page: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page' },
    count: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page Size' },
    highlight: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Highlight Matches',
    },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
    cursor: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Cursor' },
  },
  input: z.object({
    query: z.string().trim().min(1),
    sort: z.enum(['score', 'timestamp']).optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().min(1).optional(),
    count: z.number().int().min(1).max(100).optional(),
    highlight: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
    cursor: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), query: z.string(), messages: messageSearchSchema }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    query: { type: 'string', description: 'Query' },
    messages: { ...messageSearchOutput },
  },
})
