import type { NotionResponse } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export interface NotionReadDatabaseParams {
  databaseId: string
  accessToken: string
}

export const notionReadDatabaseTool: ToolConfig<NotionReadDatabaseParams, NotionResponse> = {
  id: 'notion_read_database',
  name: 'Read Notion Database',
  description: 'Read database information and structure from Notion',
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
      description: 'The ID of the Notion database to read',
    },
  },

  request: {
    url: (params: NotionReadDatabaseParams) => {
      // Format database ID with hyphens if needed
      const formattedId = params.databaseId.replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
      )

      return `https://api.notion.com/v1/databases/${formattedId}`
    },
    method: 'GET',
    headers: (params: NotionReadDatabaseParams) => {
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
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Notion API error: ${errorData.message || 'Unknown error'}`)
    }

    const data = await response.json()

    // Extract database title
    const title = data.title?.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'

    // Extract properties for display
    const properties = data.properties || {}
    const propertyList = Object.entries(properties)
      .map(([name, prop]: [string, any]) => `  ${name}: ${prop.type}`)
      .join('\\n')

    const content = [
      `Database: ${title}`,
      '',
      'Properties:',
      propertyList,
      '',
      `Database ID: ${data.id}`,
      `URL: ${data.url}`,
      `Created: ${data.created_time ? new Date(data.created_time).toLocaleDateString() : 'Unknown'}`,
      `Last edited: ${data.last_edited_time ? new Date(data.last_edited_time).toLocaleDateString() : 'Unknown'}`,
    ].join('\\n')

    return {
      success: true,
      output: {
        content,
        metadata: {
          title,
          url: data.url,
          id: data.id,
          createdTime: data.created_time,
          lastEditedTime: data.last_edited_time,
          properties: data.properties,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to read Notion database'
  },
}
