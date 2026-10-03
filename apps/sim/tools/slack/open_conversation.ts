import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'
import { conversationOutput, conversationSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/conversations.open/ */
export const slackOpenConversationTool = createSlackWebApiTool({
  id: 'slack_open_conversation',
  name: 'Slack Open Conversation',
  description:
    'Open a DM or group DM with 1–8 user IDs, or resume a conversation by ID. Supply exactly one target; omit the calling user from User IDs.',
  endpoint: 'conversations.open',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: [] },
  params: {
    users: { type: 'json', required: false, visibility: 'user-or-llm', description: 'User IDs' },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation ID',
    },
    prevent_creation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only Resume Existing Conversation',
    },
    return_im: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Conversation Details',
    },
  },
  input: z
    .object({
      users: slackJson(z.array(slackId).min(1).max(8))
        .transform((ids) => ids.join(','))
        .optional(),
      channel: z.string().trim().min(1).optional(),
      prevent_creation: z.boolean().optional(),
      return_im: z.boolean().optional(),
    })
    .refine(
      (p) => (p.users !== undefined) !== (p.channel !== undefined),
      'Provide exactly one of User IDs or Conversation ID'
    ),
  output: z
    .object({ ok: z.literal(true), channel: conversationSchema })
    .transform(({ channel, ...rest }) => ({ ...rest, conversation: channel })),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, conversation: { ...conversationOutput } },
})
