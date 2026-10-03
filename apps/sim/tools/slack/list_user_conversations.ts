import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import {
  conversationOutput,
  conversationSchema,
  metadataOutput,
  metadataSchema,
} from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/users.conversations/ */
export const slackListUserConversationsTool = createSlackWebApiTool({
  id: 'slack_list_user_conversations',
  name: 'Slack List User Conversations',
  description:
    'List one page of conversations accessible to the selected user. Continue with response_metadata.next_cursor.',
  endpoint: 'users.conversations',
  method: 'GET',
  oauth: { required: true, provider: 'slack', requiredScopes: [] },
  params: {
    user: { type: 'string', required: false, visibility: 'user-or-llm', description: 'User ID' },
    types: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated public_channel, private_channel, mpim, im.',
    },
    exclude_archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude Archived',
    },
    exclude_muted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude Muted',
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
    types: z.string().trim().min(1).optional(),
    exclude_archived: z.boolean().optional(),
    exclude_muted: z.boolean().optional(),
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(999).optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    channels: z.array(conversationSchema),
    response_metadata: metadataSchema.optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    channels: { type: 'array', description: 'Channels', items: { ...conversationOutput } },
    response_metadata: { ...metadataOutput, optional: true },
  },
})
