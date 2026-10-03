import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import {
  itemOutput,
  itemSchema,
  metadataOutput,
  metadataSchema,
} from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/reactions.list/ */
export const slackListReactionsTool = createSlackWebApiTool({
  id: 'slack_list_reactions',
  name: 'Slack List Reactions',
  description:
    'List one page of items reacted to by a user. Continue with response_metadata.next_cursor.',
  endpoint: 'reactions.list',
  method: 'GET',
  oauth: { required: true, provider: 'slack', requiredScopes: ['reactions:read'] },
  params: {
    user: { type: 'string', required: false, visibility: 'user-or-llm', description: 'User ID' },
    full: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include All Reacting Users',
    },
    cursor: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Cursor' },
    limit: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page Size' },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
  },
  input: z.object({
    user: z.string().trim().min(1).optional(),
    full: z.boolean().optional(),
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(999).optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    items: z.array(itemSchema),
    response_metadata: metadataSchema.optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    items: { type: 'array', description: 'Items', items: { ...itemOutput } },
    response_metadata: { ...metadataOutput, optional: true },
  },
})
