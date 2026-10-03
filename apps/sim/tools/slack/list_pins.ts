import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { itemOutput, itemSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/pins.list/ */
export const slackListPinsTool = createSlackWebApiTool({
  id: 'slack_list_pins',
  name: 'Slack List Pins',
  description: 'Read the pinned messages and files in a Slack conversation.',
  endpoint: 'pins.list',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['pins:read'],
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
  output: z.object({ ok: z.literal(true), items: z.array(itemSchema) }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    items: { type: 'array', description: 'Items', items: { ...itemOutput } },
  },
})
