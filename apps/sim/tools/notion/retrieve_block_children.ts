import type { NotionRetrieveBlockChildrenParams } from '@/tools/notion/types'
import { BLOCK_LIST_RESULTS_OUTPUT, PAGINATION_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionRetrieveBlockChildrenResponse {
  success: boolean
  output: {
    results: any[]
    has_more: boolean
    next_cursor: string | null
  }
}

export const notionRetrieveBlockChildrenTool: ToolConfig<
  NotionRetrieveBlockChildrenParams,
  NotionRetrieveBlockChildrenResponse
> = {
  id: 'notion_retrieve_block_children',
  name: 'Notion Retrieve Block Children',
  description: 'Retrieve the block children (content) of a Notion page or block',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'notion',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Notion OAuth access token',
    },
    blockId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the page or block whose children to retrieve',
    },
    startCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous request',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-100, default 100)',
    },
  },

  request: {
    url: (params: NotionRetrieveBlockChildrenParams) => {
      const url = new URL(`https://api.notion.com/v1/blocks/${params.blockId.trim()}/children`)
      if (params.startCursor) url.searchParams.set('start_cursor', params.startCursor.trim())
      if (params.pageSize != null) url.searchParams.set('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params: NotionRetrieveBlockChildrenParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: response.ok,
      output: {
        results: data.results ?? [],
        has_more: data.has_more ?? false,
        next_cursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    results: BLOCK_LIST_RESULTS_OUTPUT,
    has_more: PAGINATION_OUTPUT_PROPERTIES.has_more,
    next_cursor: PAGINATION_OUTPUT_PROPERTIES.next_cursor,
  },
}

export const notionRetrieveBlockChildrenV2Tool: ToolConfig<
  NotionRetrieveBlockChildrenParams,
  NotionRetrieveBlockChildrenResponse
> = {
  id: 'notion_retrieve_block_children_v2',
  name: 'Notion Retrieve Block Children',
  description: 'Retrieve the block children (content) of a Notion page or block',
  version: '2.0.0',
  oauth: notionRetrieveBlockChildrenTool.oauth,
  params: notionRetrieveBlockChildrenTool.params,
  request: notionRetrieveBlockChildrenTool.request,
  transformResponse: notionRetrieveBlockChildrenTool.transformResponse,
  outputs: notionRetrieveBlockChildrenTool.outputs,
}
