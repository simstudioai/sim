import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import {
  fileSearchOutput,
  fileSearchSchema,
  messageSearchOutput,
  messageSearchSchema,
} from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/search.all/ */
export const slackSearchAllTool = createSlackWebApiTool({
  id: 'slack_search_all',
  name: 'Slack Search Messages and Files',
  description:
    'Search messages and files visible to the authorized Slack user. Requires a managed user credential with search:read. Each result collection includes paging.',
  endpoint: 'search.all',
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
  },
  input: z.object({
    query: z.string().trim().min(1),
    sort: z.enum(['score', 'timestamp']).optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().min(1).optional(),
    count: z.number().int().min(1).max(100).optional(),
    highlight: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    query: z.string(),
    messages: messageSearchSchema,
    files: fileSearchSchema,
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    query: { type: 'string', description: 'Query' },
    messages: { ...messageSearchOutput },
    files: { ...fileSearchOutput },
  },
})
