import type { NotionResponse } from '@/tools/notion/types'
import { DATABASE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
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
      visibility: 'user-or-llm',
      description: 'The UUID of the Notion database to read',
    },
  },

  request: {
    url: (params: NotionReadDatabaseParams) => {
      return `https://api.notion.com/v1/databases/${params.databaseId}`
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
    const data = await response.json()

    // Extract database title
    const title = data.title?.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'

    // Extract properties for display
    const properties = data.properties || {}
    const propertyList = Object.entries(properties)
      .map(([name, prop]: [string, any]) => `  ${name}: ${prop.type}`)
      .join('\n')

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
    ].join('\n')

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

  outputs: {
    content: {
      type: 'string',
      description: 'Database information including title, properties schema, and metadata',
    },
    metadata: {
      type: 'object',
      description: 'Database metadata including title, ID, URL, timestamps, and properties schema',
      properties: {
        title: { type: 'string', description: 'Database title' },
        url: DATABASE_OUTPUT_PROPERTIES.url,
        id: DATABASE_OUTPUT_PROPERTIES.id,
        createdTime: DATABASE_OUTPUT_PROPERTIES.created_time,
        lastEditedTime: DATABASE_OUTPUT_PROPERTIES.last_edited_time,
        properties: DATABASE_OUTPUT_PROPERTIES.properties,
      },
    },
  },
}

interface NotionReadDatabaseV2Response {
  success: boolean
  output: {
    id: string
    title: string
    url: string
    created_time: string
    last_edited_time: string
    properties: Record<string, any>
  }
}

export const notionReadDatabaseV2Tool: ToolConfig<
  NotionReadDatabaseParams,
  NotionReadDatabaseV2Response
> = {
  id: 'notion_read_database_v2',
  name: 'Read Notion Database',
  description: 'Read database information and structure from Notion',
  version: '2.0.0',
  oauth: notionReadDatabaseTool.oauth,
  params: notionReadDatabaseTool.params,
  request: notionReadDatabaseTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const title = data.title?.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'

    return {
      success: true,
      output: {
        id: data.id,
        title,
        url: data.url,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
        properties: data.properties || {},
      },
    }
  },

  outputs: {
    id: DATABASE_OUTPUT_PROPERTIES.id,
    title: { type: 'string', description: 'Database title' },
    url: DATABASE_OUTPUT_PROPERTIES.url,
    created_time: DATABASE_OUTPUT_PROPERTIES.created_time,
    last_edited_time: DATABASE_OUTPUT_PROPERTIES.last_edited_time,
    properties: DATABASE_OUTPUT_PROPERTIES.properties,
  },
}
