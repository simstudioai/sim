import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type {
  SlackListsItemsListParams,
  SlackListsItemsListResponse,
} from '@/tools/slack_lists/types'
import {
  LIST_ITEM_OUTPUT_PROPERTIES,
  LIST_SUMMARY_OUTPUT_PROPERTIES,
} from '@/tools/slack_lists/types'
import {
  listItemResponseSchema,
  listSummaryResponseSchema,
  slackListsHeaders,
} from '@/tools/slack_lists/utils'
import { slackListIdSchema } from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsItemsListTool: ToolConfig<
  SlackListsItemsListParams,
  SlackListsItemsListResponse
> = {
  id: 'slack_lists_items_list',
  name: 'Slack Lists List Items',
  description:
    'Read a page of Slack List rows and optionally its column schema. Pass nextCursor as cursor to continue; an empty nextCursor ends pagination.',
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
      description: 'Slack List ID, from the List URL or Create List output',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows in this page (positive integer; defaults to 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation cursor from the previous response',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return archived rows instead of active rows',
    },
    includeList: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include List title and schema (defaults to true); schema IDs are required to write cells',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.items.list',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      return {
        list_id: slackListIdSchema.parse(params.listId),
        limit: z
          .number()
          .int()
          .positive()
          .parse(params.limit ?? 100),
        cursor: params.cursor === undefined ? undefined : z.string().parse(params.cursor),
        archived: params.archived === undefined ? undefined : z.boolean().parse(params.archived),
        include_list: z.boolean().parse(params.includeList ?? true),
      }
    },
  },
  transformResponse: async (response) => {
    const data = await readSlackResponse(response)
    const result = z
      .object({
        items: z.array(listItemResponseSchema),
        list: listSummaryResponseSchema.optional(),
        response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
      })
      .parse(data)
    return {
      success: true,
      output: {
        items: result.items,
        list: result.list ?? null,
        nextCursor: result.response_metadata?.next_cursor ?? '',
      },
    }
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Rows in this page',
      items: { type: 'object', properties: LIST_ITEM_OUTPUT_PROPERTIES },
    },
    list: {
      type: 'object',
      description: 'Parent List (id, title, schema); null if not included',
      properties: LIST_SUMMARY_OUTPUT_PROPERTIES,
      nullable: true,
    },
    nextCursor: {
      type: 'string',
      description: 'Next page cursor; empty when there are no more rows',
    },
  },
}
