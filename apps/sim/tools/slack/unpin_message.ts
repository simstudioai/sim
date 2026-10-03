import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/pins.remove/ */
export const slackUnpinMessageTool = createSlackWebApiTool({
  id: 'slack_unpin_message',
  name: 'Slack Unpin Message',
  description: 'Remove a message from its conversation’s pinned items.',
  endpoint: 'pins.remove',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['pins:write'],
    credentialKind: 'service-account',
  },
  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    timestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message Timestamp',
    },
  },
  input: z.object({ channel: z.string().trim().min(1), timestamp: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
