import type { NotionListCommentsParams } from '@/tools/notion/types'
import { COMMENT_LIST_RESULTS_OUTPUT, PAGINATION_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import { clampNotionPageSize } from '@/tools/notion/utils'
import type { ToolConfig } from '@/tools/types'

interface NotionListCommentsResponse {
  success: boolean
  output: {
    results: any[]
    has_more: boolean
    next_cursor: string | null
  }
}

export const notionListCommentsTool: ToolConfig<
  NotionListCommentsParams,
  NotionListCommentsResponse
> = {
  id: 'notion_list_comments',
  name: 'Notion List Comments',
  description: 'List unresolved comments on a Notion page or block',
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
      description: 'The UUID of the page or block whose comments to list',
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
    url: (params: NotionListCommentsParams) => {
      const url = new URL('https://api.notion.com/v1/comments')
      url.searchParams.set('block_id', params.blockId.trim())
      if (params.startCursor) url.searchParams.set('start_cursor', params.startCursor.trim())
      const pageSize = clampNotionPageSize(params.pageSize)
      if (pageSize != null) url.searchParams.set('page_size', String(pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params: NotionListCommentsParams) => {
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
    results: COMMENT_LIST_RESULTS_OUTPUT,
    has_more: PAGINATION_OUTPUT_PROPERTIES.has_more,
    next_cursor: PAGINATION_OUTPUT_PROPERTIES.next_cursor,
  },
}

export const notionListCommentsV2Tool: ToolConfig<
  NotionListCommentsParams,
  NotionListCommentsResponse
> = {
  id: 'notion_list_comments_v2',
  name: 'Notion List Comments',
  description: 'List unresolved comments on a Notion page or block',
  version: '2.0.0',
  oauth: notionListCommentsTool.oauth,
  params: notionListCommentsTool.params,
  request: notionListCommentsTool.request,
  transformResponse: notionListCommentsTool.transformResponse,
  outputs: notionListCommentsTool.outputs,
}
