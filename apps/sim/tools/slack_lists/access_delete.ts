import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/slackLists.access.delete/ */
export const slackListsAccessDeleteTool = createSlackWebApiTool({
  id: 'slack_lists_access_delete',
  name: 'Slack Revoke List Access',
  description: 'Remove access to a Slack List for either users or channels.',
  endpoint: 'slackLists.access.delete',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['lists:write'],
    credentialKind: 'service-account',
  },
  params: {
    list_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'List ID' },
    user_ids: { type: 'json', required: false, visibility: 'user-or-llm', description: 'User IDs' },
    channel_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel IDs',
    },
  },
  input: z
    .object({
      list_id: z.string().trim().min(1),
      user_ids: slackJson(z.array(slackId).min(1)).optional(),
      channel_ids: slackJson(z.array(slackId).min(1)).optional(),
    })
    .refine(
      (p) => (p.user_ids !== undefined) !== (p.channel_ids !== undefined),
      'Provide exactly one of User IDs or Channel IDs'
    ),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
