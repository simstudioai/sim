import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/pins.add/ */
export const slackPinMessageTool = createSlackWebApiTool({
  id: 'slack_pin_message',
  name: 'Slack Pin Message',
  description: 'Pin a message to its Slack conversation.',
  endpoint: 'pins.add',
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
