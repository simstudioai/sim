import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/emoji.list/ */
export const slackListEmojiTool = createSlackWebApiTool({
  id: 'slack_list_emoji',
  name: 'Slack List Custom Emoji',
  description: 'List workspace custom emoji as names mapped to image URLs or alias references.',
  endpoint: 'emoji.list',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['emoji:read'],
    credentialKind: 'service-account',
  },
  params: {},
  input: z.object({}),
  output: z.object({ ok: z.literal(true), emoji: z.record(z.string(), z.string()).optional() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    emoji: {
      type: 'json',
      description: 'Custom emoji names mapped to image URLs or alias:name values',
      optional: true,
    },
  },
})
