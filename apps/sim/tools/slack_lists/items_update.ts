import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackListsItemsUpdateParams, SlackListsOkResponse } from '@/tools/slack_lists/types'
import { OK_OUTPUT } from '@/tools/slack_lists/types'
import { slackListsHeaders } from '@/tools/slack_lists/utils'
import {
  parseSlackListsJson,
  slackListIdSchema,
  updateCellSchema,
} from '@/tools/slack_lists/validation'
import type { ToolConfig } from '@/tools/types'

export const slackListsItemsUpdateTool: ToolConfig<
  SlackListsItemsUpdateParams,
  SlackListsOkResponse
> = {
  id: 'slack_lists_items_update',
  name: 'Slack Lists Update Items',
  description:
    'Update cells across Slack List rows. Each cell requires row_id, column_id, and one typed value. Use empty arrays to clear array-valued cells, or false to clear a checkbox.',
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
    cells: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonempty array of cells with row_id, column_id and a typed value (e.g. {"row_id":"Rec...","column_id":"Col...","checkbox":true}). Text uses rich_text blocks.',
    },
  },
  request: {
    url: 'https://slack.com/api/slackLists.items.update',
    method: 'POST',
    headers: slackListsHeaders,
    body: (params) => {
      return {
        list_id: slackListIdSchema.parse(params.listId),
        cells: parseSlackListsJson(params.cells, z.array(updateCellSchema).min(1), 'cells'),
      }
    },
  },
  transformResponse: async (response) => {
    await readSlackResponse(response)
    return { success: true, output: { ok: true } }
  },
  outputs: { ok: OK_OUTPUT },
}
