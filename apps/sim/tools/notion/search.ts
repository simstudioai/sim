import type { NotionResponse, NotionSearchParams } from '@/tools/notion/types'
import { extractTitleFromItem } from '@/tools/notion/utils'
import type { ToolConfig } from '@/tools/types'

export const notionSearchTool: ToolConfig<NotionSearchParams, NotionResponse> = {
  id: 'notion_search',
  name: 'Search Notion Workspace',
  description: 'Search across all pages and databases in Notion workspace',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search terms (leave empty to get all pages)',
    },
    filterType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by object type: page, database, or leave empty for all',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 100, max: 100)',
    },
  },

  request: {
    url: () => 'https://api.notion.com/v1/search',
    method: 'POST',
    headers: (params: NotionSearchParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionSearchParams) => {
      const body: any = {}

      // Add query if provided
      if (params.query?.trim()) {
        body.query = params.query.trim()
      }

      // Add filter if provided (skip 'all' as it means no filter)
      if (
        params.filterType &&
        params.filterType !== 'all' &&
        ['page', 'database'].includes(params.filterType)
      ) {
        body.filter = {
          value: params.filterType,
          property: 'object',
        }
      }

      // Add page size if provided
      if (params.pageSize) {
        body.page_size = Math.min(Number(params.pageSize), 100)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const results = data.results || []

    // Format the results into readable content
    const content = results
      .map((item: any, index: number) => {
        const objectType = item.object === 'page' ? 'Page' : 'Database'
        const title = extractTitleFromItem(item)
        const url = item.url || ''
        const lastEdited = item.last_edited_time
          ? new Date(item.last_edited_time).toLocaleDateString()
          : ''

        return [
          `${index + 1}. ${objectType}: ${title}`,
          `   URL: ${url}`,
          lastEdited ? `   Last edited: ${lastEdited}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n')

    return {
      success: true,
      output: {
        content: content || 'No results found',
        metadata: {
          totalResults: results.length,
          hasMore: data.has_more || false,
          nextCursor: data.next_cursor || null,
          results: results,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Formatted list of search results including pages and databases',
    },
    metadata: {
      type: 'object',
      description:
        'Search metadata including total results count, pagination info, and raw results array',
    },
  },
}
