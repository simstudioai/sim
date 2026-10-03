import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/conversations.unarchive/ */
export const slackUnarchiveConversationTool = createSlackWebApiTool({
  id: 'slack_unarchive_conversation',
  name: 'Slack Unarchive Conversation',
  description: 'Restore an archived Slack channel.',
  endpoint: 'conversations.unarchive',
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
