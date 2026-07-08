import type { NotionListUsersParams } from '@/tools/notion/types'
import { PAGINATION_OUTPUT_PROPERTIES, USER_LIST_RESULTS_OUTPUT } from '@/tools/notion/types'
import { clampNotionPageSize } from '@/tools/notion/utils'
import type { ToolConfig } from '@/tools/types'

interface NotionListUsersResponse {
  success: boolean
  output: {
    results: any[]
    has_more: boolean
    next_cursor: string | null
  }
}

export const notionListUsersTool: ToolConfig<NotionListUsersParams, NotionListUsersResponse> = {
  id: 'notion_list_users',
  name: 'Notion List Users',
  description: 'List all users (members and bots) in the Notion workspace',
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
    url: (params: NotionListUsersParams) => {
      const url = new URL('https://api.notion.com/v1/users')
      if (params.startCursor) url.searchParams.set('start_cursor', params.startCursor.trim())
      const pageSize = clampNotionPageSize(params.pageSize)
      if (pageSize != null) url.searchParams.set('page_size', String(pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params: NotionListUsersParams) => {
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
    results: USER_LIST_RESULTS_OUTPUT,
    has_more: PAGINATION_OUTPUT_PROPERTIES.has_more,
    next_cursor: PAGINATION_OUTPUT_PROPERTIES.next_cursor,
  },
}

export const notionListUsersV2Tool: ToolConfig<NotionListUsersParams, NotionListUsersResponse> = {
  id: 'notion_list_users_v2',
  name: 'Notion List Users',
  description: 'List all users (members and bots) in the Notion workspace',
  version: '2.0.0',
  oauth: notionListUsersTool.oauth,
  params: notionListUsersTool.params,
  request: notionListUsersTool.request,
  transformResponse: notionListUsersTool.transformResponse,
  outputs: notionListUsersTool.outputs,
}
