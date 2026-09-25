import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsItemParams, SlackListsOkResponse } from '@/tools/slack_lists/types'
import { OK_OUTPUT } from '@/tools/slack_lists/types'
import { slackListsHeaders } from '@/tools/slack_lists/utils'
import { slackListIdSchema, slackListItemIdSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsItemsDeleteTool: ToolConfig<SlackListsItemParams, SlackListsOkResponse> = {
  id: 'slack_lists_items_delete',
  name: 'Slack Lists Delete Item',
  description: 'Delete a row from an existing Slack List.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    credentialKind: 'service-account',
    requiredScopes: ['lists:write'],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Resolved custom Slack bot token',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slack List ID',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Row ID to delete',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.items.delete',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      return {
        list_id: slackListIdSchema.parse(params.listId),
        id: slackListItemIdSchema.parse(params.itemId),
      }
    },
  },
  transformResponse: async (response) => {
    await readSlackResponse(response)
    return { success: true, output: { ok: true } }
  },
  outputs: { ok: OK_OUTPUT },
}
