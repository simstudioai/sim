import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/conversations.close/ */
export const slackCloseConversationTool = createSlackWebApiTool({
  id: 'slack_close_conversation',
  name: 'Slack Close Conversation',
  description:
    'Close a direct message or group direct message for the authenticated identity. The Sim app can close 1:1 direct messages only; closing a group direct message needs a custom bot with the mpim:write scope.',
  endpoint: 'conversations.close',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: [] },
  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
  },
  input: z.object({ channel: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
