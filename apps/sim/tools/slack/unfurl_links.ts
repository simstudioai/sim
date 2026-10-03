import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/chat.unfurl/ */
export const slackUnfurlLinksTool = createSlackWebApiTool({
  id: 'slack_unfurl_links',
  name: 'Slack Unfurl Links',
  description:
    'Attach custom previews to links already shared in a message. Configure the relevant unfurl domains in your Slack app.',
  endpoint: 'chat.unfurl',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['links:write'],
    credentialKind: 'service-account',
  },
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
      description: 'Message Timestamp',
    },
    unfurls: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object keyed by each shared URL, with Slack attachment fields or blocks as the value.',
    },
  },
  input: z.object({
    channel: z.string().trim().min(1),
    ts: z.string().trim().min(1),
    unfurls: slackJson(
      z
        .record(
          z.url(),
          z
            .object({
              blocks: z.array(z.object({ type: slackId }).passthrough()).optional(),
              text: z.string().optional(),
              title: z.string().optional(),
            })
            .passthrough()
        )
        .refine((unfurls) => Object.keys(unfurls).length > 0, 'Provide at least one URL preview')
    ),
  }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
