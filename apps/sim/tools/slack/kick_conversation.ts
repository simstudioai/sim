import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/conversations.kick/ */
export const slackKickConversationTool = createSlackWebApiTool({
  id: 'slack_kick_conversation',
  name: 'Slack Remove User from Conversation',
  description: 'Remove a user from a Slack conversation, subject to workspace permissions.',
  endpoint: 'conversations.kick',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: [] },
  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    user: { type: 'string', required: true, visibility: 'user-or-llm', description: 'User ID' },
  },
  input: z.object({ channel: z.string().trim().min(1), user: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
