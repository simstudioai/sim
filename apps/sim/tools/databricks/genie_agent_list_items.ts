import {
  type DatabricksGenieAgentListItemsParams,
  type DatabricksGenieAgentListItemsResponse,
  GENIE_AGENT_ITEM_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import {
  databricksErrorMessage,
  databricksUrl,
  GENIE_READ_RETRY,
  GENIE_SPACE_PARAMS,
  genieAgentPath,
  mapGenieAgentItem,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const genieAgentListItemsTool: ToolConfig<
  DatabricksGenieAgentListItemsParams,
  DatabricksGenieAgentListItemsResponse
> = {
  id: 'databricks_genie_agent_list_items',
  name: 'Databricks Genie Agent List Items',
  description:
    "List an agent-mode conversation's full history in order: questions, reasoning, SQL calls, query results, and reports. Agent mode is in preview and must be enabled on the workspace.",
  version: '1.0.0',

  params: {
    ...GENIE_SPACE_PARAMS,
    spaceId: {
      ...GENIE_SPACE_PARAMS.spaceId,
      description: 'The ID of the Genie space (the Genie agent ID)',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the agent-mode conversation',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (1-100, default 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the lastId from a previous response',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc (oldest first, default) or desc (newest first)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        databricksUrl(
          params.host,
          `${genieAgentPath(params.spaceId)}/conversations/${safeUrlPathSegment(params.conversationId, 'conversationId')}/items`
        )
      )
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.after) url.searchParams.set('after', params.after)
      if (params.order) url.searchParams.set('order', params.order)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    retry: GENIE_READ_RETRY,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(databricksErrorMessage(data, 'Failed to list Genie agent conversation items'))
    }

    return {
      success: true,
      output: {
        items: (data.data ?? []).map(mapGenieAgentItem),
        firstId: data.first_id ?? null,
        lastId: data.last_id ?? null,
        hasMore: data.has_more ?? false,
        status: data.status ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description:
        'Conversation items in order; user questions are message items whose ID ends in _input',
      items: {
        type: 'object',
        properties: GENIE_AGENT_ITEM_OUTPUT_PROPERTIES,
      },
    },
    firstId: { type: 'string', description: 'ID of the first item in the page', nullable: true },
    lastId: {
      type: 'string',
      description: 'ID of the last item in the page; pass it as After for the next page',
      nullable: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more items follow this page' },
    status: {
      type: 'string',
      description: 'Status of the latest response in the conversation',
      nullable: true,
    },
  },
}
