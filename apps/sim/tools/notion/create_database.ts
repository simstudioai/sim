import type { NotionCreateDatabaseParams, NotionResponse } from '@/tools/notion/types'
import { DATABASE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionCreateDatabaseTool: ToolConfig<NotionCreateDatabaseParams, NotionResponse> = {
  id: 'notion_create_database',
  name: 'Create Notion Database',
  description: 'Create a new database in Notion with custom properties',
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
    parentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the parent page where the database will be created',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title for the new database',
    },
    properties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Database properties as JSON object (optional, will create a default "Name" property if empty)',
    },
  },

  request: {
    url: () => 'https://api.notion.com/v1/databases',
    method: 'POST',
    headers: (params: NotionCreateDatabaseParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionCreateDatabaseParams) => {
      // Use provided properties or default to Name property
      const properties =
        params.properties && Object.keys(params.properties).length > 0
          ? params.properties
          : { Name: { title: {} } }

      const body = {
        parent: {
          type: 'page_id',
          page_id: params.parentId,
        },
        title: [
          {
            type: 'text',
            text: {
              content: params.title,
            },
          },
        ],
        properties,
      }

      return body
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
      `Database "${title}" created successfully!`,
      '',
      'Properties:',
      propertyList,
      '',
      `Database ID: ${data.id}`,
      `URL: ${data.url}`,
    ].join('\n')

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          title,
          url: data.url,
          createdTime: data.created_time,
          properties: data.properties,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Success message with database details and properties list',
    },
    metadata: {
      type: 'object',
      description:
        'Database metadata including ID, title, URL, creation time, and properties schema',
      properties: {
        id: DATABASE_OUTPUT_PROPERTIES.id,
        title: { type: 'string', description: 'Database title' },
        url: DATABASE_OUTPUT_PROPERTIES.url,
        createdTime: DATABASE_OUTPUT_PROPERTIES.created_time,
        properties: DATABASE_OUTPUT_PROPERTIES.properties,
      },
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionCreateDatabaseV2Response {
  success: boolean
  output: {
    id: string
    title: string
    url: string
    created_time: string
    properties: Record<string, any>
  }
}

export const notionCreateDatabaseV2Tool: ToolConfig<
  NotionCreateDatabaseParams,
  NotionCreateDatabaseV2Response
> = {
  id: 'notion_create_database_v2',
  name: 'Create Notion Database',
  description: 'Create a new database in Notion with custom properties',
  version: '2.0.0',
  oauth: notionCreateDatabaseTool.oauth,
  params: notionCreateDatabaseTool.params,
  request: notionCreateDatabaseTool.request,

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
        properties: data.properties || {},
      },
    }
  },

  outputs: {
    id: DATABASE_OUTPUT_PROPERTIES.id,
    title: { type: 'string', description: 'Database title' },
    url: DATABASE_OUTPUT_PROPERTIES.url,
    created_time: DATABASE_OUTPUT_PROPERTIES.created_time,
    properties: DATABASE_OUTPUT_PROPERTIES.properties,
  },
}
