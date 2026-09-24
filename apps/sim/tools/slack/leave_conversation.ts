import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/conversations.leave/ */
export const slackLeaveConversationTool = createSlackWebApiTool({
  id: 'slack_leave_conversation',
  name: 'Slack Leave Conversation',
  description: 'Leave a Slack channel as the authenticated identity.',
  endpoint: 'conversations.leave',
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
