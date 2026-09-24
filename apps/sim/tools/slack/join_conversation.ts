import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { conversationOutput, conversationSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/conversations.join/ */
export const slackJoinConversationTool = createSlackWebApiTool({
  id: 'slack_join_conversation',
  name: 'Slack Join Conversation',
  description: 'Join a public Slack channel as the authenticated bot.',
  endpoint: 'conversations.join',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['channels:join'],
    credentialKind: 'service-account',
  },
  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
  },
  input: z.object({ channel: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true), channel: conversationSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, channel: { ...conversationOutput } },
})
