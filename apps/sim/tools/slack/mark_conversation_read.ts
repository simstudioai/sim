import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/conversations.mark/ */
export const slackMarkConversationReadTool = createSlackWebApiTool({
  id: 'slack_mark_conversation_read',
  name: 'Slack Mark Conversation Read',
  description: 'Move the authenticated identity’s read cursor to a message timestamp.',
  endpoint: 'conversations.mark',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: [] },
  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    ts: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Read Through Timestamp',
    },
  },
  input: z.object({ channel: z.string().trim().min(1), ts: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
