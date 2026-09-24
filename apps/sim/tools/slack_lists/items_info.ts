import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsItemParams, SlackListsItemsInfoResponse } from '@/tools/slack_lists/types'
import { LIST_ITEM_OUTPUT, LIST_SUMMARY_OUTPUT } from '@/tools/slack_lists/types'
import {
  listItemResponseSchema,
  listSummaryResponseSchema,
  slackListsHeaders,
} from '@/tools/slack_lists/utils'
import { slackListIdSchema, slackListItemIdSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsItemsInfoTool: ToolConfig<
  SlackListsItemParams,
  SlackListsItemsInfoResponse
> = {
  id: 'slack_lists_items_info',
  name: 'Slack Lists Get Item',
  description: 'Read a Slack List row and its parent List column schema.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    credentialKind: 'service-account',
    requiredScopes: ['lists:read'],
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
      description: 'Row ID returned by List Items or Create Item',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.items.info',
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
    const data = await readSlackResponse(response)
    const result = z
      .object({ record: listItemResponseSchema, list: listSummaryResponseSchema })
      .parse(data)
    return { success: true, output: { item: result.record, list: result.list } }
  },
  outputs: { item: LIST_ITEM_OUTPUT, list: LIST_SUMMARY_OUTPUT },
}
