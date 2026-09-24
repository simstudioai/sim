import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type {
  SlackListsItemsCreateParams,
  SlackListsItemsCreateResponse,
} from '@/tools/slack_lists/types'
import { LIST_ITEM_OUTPUT } from '@/tools/slack_lists/types'
import { listItemResponseSchema, slackListsHeaders } from '@/tools/slack_lists/utils'
import {
  fieldSchema,
  parseSlackListsJson,
  slackListIdSchema,
  slackListItemIdSchema,
} from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsItemsCreateTool: ToolConfig<
  SlackListsItemsCreateParams,
  SlackListsItemsCreateResponse
> = {
  id: 'slack_lists_items_create',
  name: 'Slack Lists Create Item',
  description:
    'Create a Slack List row using real column IDs and typed cell values. Text columns require rich_text, not text.',
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
    initialFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of typed fields, each with column_id and exactly one value such as rich_text, number, select, date, user, or checkbox. Use schema IDs from List Items (includeList=true).',
    },
    parentItemId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent row ID when creating a subtask',
    },
    duplicatedItemId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing row ID to duplicate',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.items.create',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      return {
        list_id: slackListIdSchema.parse(params.listId),
        initial_fields:
          params.initialFields === undefined
            ? undefined
            : parseSlackListsJson(params.initialFields, z.array(fieldSchema), 'initialFields'),
        parent_item_id:
          params.parentItemId === undefined
            ? undefined
            : slackListItemIdSchema.parse(params.parentItemId),
        duplicated_item_id:
          params.duplicatedItemId === undefined
            ? undefined
            : slackListItemIdSchema.parse(params.duplicatedItemId),
      }
    },
  },
  transformResponse: async (response) => {
    const data = await readSlackResponse(response)
    return { success: true, output: { item: listItemResponseSchema.parse(data.item) } }
  },
  outputs: { item: LIST_ITEM_OUTPUT },
}
