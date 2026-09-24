import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/slackLists.items.deleteMultiple/ */
export const slackListsItemsDeleteMultipleTool = createSlackWebApiTool({
  id: 'slack_lists_items_delete_multiple',
  name: 'Slack Delete List Items',
  description: 'Delete multiple rows from a Slack List in one call.',
  endpoint: 'slackLists.items.deleteMultiple',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['lists:write'],
    credentialKind: 'service-account',
  },
  params: {
    list_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'List ID' },
    ids: { type: 'json', required: true, visibility: 'user-or-llm', description: 'Row IDs' },
  },
  input: z.object({ list_id: z.string().trim().min(1), ids: slackJson(z.array(slackId).min(1)) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
