import type { NotionQueryDatabaseParams, NotionResponse } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionQueryDatabaseTool: ToolConfig<NotionQueryDatabaseParams, NotionResponse> = {
  id: 'notion_query_database',
  name: 'Query Notion Database',
  description: 'Query and filter Notion database entries with advanced filtering',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'notion',
    additionalScopes: ['workspace.content', 'database.read'],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Notion OAuth access token',
    },
    databaseId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the database to query',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter conditions as JSON (optional)',
    },
    sorts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort criteria as JSON array (optional)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 100, max: 100)',
    },
  },
  outputs: {
    content: {
      type: 'string',
      description: 'Formatted list of database entries with their properties',
    },
    metadata: {
      type: 'object',
      description:
        'Query metadata including total results count, pagination info, and raw results array',
      properties: {
        totalResults: { type: 'number', description: 'Number of results returned' },
        hasMore: { type: 'boolean', description: 'Whether more results are available' },
        nextCursor: { type: 'string', description: 'Cursor for pagination', optional: true },
        results: {
          type: 'array',
          description: 'Raw Notion page objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Page ID' },
              properties: { type: 'object', description: 'Page properties' },
              created_time: { type: 'string', description: 'Creation timestamp' },
              last_edited_time: { type: 'string', description: 'Last edit timestamp' },
              url: { type: 'string', description: 'Page URL' },
              archived: { type: 'boolean', description: 'Whether page is archived' },
            },
          },
        },
      },
    },
  },

  request: {
    url: (params: NotionQueryDatabaseParams) => {
      const formattedId = params.databaseId.replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
      )
      return `https://api.notion.com/v1/databases/${formattedId}/query`
    },
    method: 'POST',
    headers: (params: NotionQueryDatabaseParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionQueryDatabaseParams) => {
      const body: any = {}

      // Add filter if provided
      if (params.filter) {
        try {
          body.filter = JSON.parse(params.filter)
        } catch (error) {
          throw new Error(
            `Invalid filter JSON: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      // Add sorts if provided
      if (params.sorts) {
        try {
          body.sorts = JSON.parse(params.sorts)
        } catch (error) {
          throw new Error(
            `Invalid sorts JSON: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      // Add page size if provided
      if (params.pageSize) {
        body.page_size = Math.min(params.pageSize, 100)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Notion API error: ${errorData.message || 'Unknown error'}`)
    }

    const data = await response.json()
    const results = data.results || []

    // Format the results into readable content
    const content = results
      .map((page: any, index: number) => {
        const properties = page.properties || {}
        const title = extractTitle(properties)
        const propertyValues = Object.entries(properties)
          .map(([key, value]: [string, any]) => {
            const formattedValue = formatPropertyValue(value)
            return `  ${key}: ${formattedValue}`
          })
          .join('\n')

        return `Entry ${index + 1}${title ? ` - ${title}` : ''}:\n${propertyValues}`
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

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to query Notion database'
  },
}

// Helper function to extract title from properties
function extractTitle(properties: Record<string, any>): string {
  for (const [, value] of Object.entries(properties)) {
    if (
      value.type === 'title' &&
      value.title &&
      Array.isArray(value.title) &&
      value.title.length > 0
    ) {
      return value.title.map((t: any) => t.plain_text || '').join('')
    }
  }
  return ''
}

// Helper function to format property values
function formatPropertyValue(property: any): string {
  switch (property.type) {
    case 'title':
      return property.title?.map((t: any) => t.plain_text || '').join('') || ''
    case 'rich_text':
      return property.rich_text?.map((t: any) => t.plain_text || '').join('') || ''
    case 'number':
      return String(property.number || '')
    case 'select':
      return property.select?.name || ''
    case 'multi_select':
      return property.multi_select?.map((s: any) => s.name).join(', ') || ''
    case 'date':
      return property.date?.start || ''
    case 'checkbox':
      return property.checkbox ? 'Yes' : 'No'
    case 'url':
      return property.url || ''
    case 'email':
      return property.email || ''
    case 'phone_number':
      return property.phone_number || ''
    default:
      return JSON.stringify(property)
  }
}
