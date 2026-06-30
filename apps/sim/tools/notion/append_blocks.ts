import type { NotionAppendBlocksParams } from '@/tools/notion/types'
import { BLOCK_LIST_RESULTS_OUTPUT, PAGINATION_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionAppendBlocksResponse {
  success: boolean
  output: {
    results: any[]
    has_more: boolean
    next_cursor: string | null
  }
}

/**
 * Coerce the children param into a block array, accepting either a JSON string
 * (when called directly by an agent) or an already-parsed array.
 */
function parseChildren(children: any[] | string): any[] {
  if (Array.isArray(children)) return children
  if (typeof children === 'string') {
    const parsed = JSON.parse(children)
    if (!Array.isArray(parsed)) {
      throw new Error('children must be a JSON array of Notion block objects')
    }
    return parsed
  }
  throw new Error('children must be a JSON array of Notion block objects')
}

export const notionAppendBlocksTool: ToolConfig<
  NotionAppendBlocksParams,
  NotionAppendBlocksResponse
> = {
  id: 'notion_append_blocks',
  name: 'Notion Append Block Children',
  description: 'Append new block children (content) to a Notion page or block',
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
      description: 'The UUID of the page or block to append children to',
    },
    children: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of Notion block objects to append (max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of an existing block to append the new children after',
    },
  },

  request: {
    url: (params: NotionAppendBlocksParams) =>
      `https://api.notion.com/v1/blocks/${params.blockId.trim()}/children`,
    method: 'PATCH',
    headers: (params: NotionAppendBlocksParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionAppendBlocksParams) => {
      const body: any = { children: parseChildren(params.children) }
      if (params.after) body.after = params.after.trim()
      return body
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

export const notionAppendBlocksV2Tool: ToolConfig<
  NotionAppendBlocksParams,
  NotionAppendBlocksResponse
> = {
  id: 'notion_append_blocks_v2',
  name: 'Notion Append Block Children',
  description: 'Append new block children (content) to a Notion page or block',
  version: '2.0.0',
  oauth: notionAppendBlocksTool.oauth,
  params: notionAppendBlocksTool.params,
  request: notionAppendBlocksTool.request,
  transformResponse: notionAppendBlocksTool.transformResponse,
  outputs: notionAppendBlocksTool.outputs,
}
