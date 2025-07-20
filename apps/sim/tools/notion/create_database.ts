import type { NotionCreateDatabaseParams, NotionResponse } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionCreateDatabaseTool: ToolConfig<NotionCreateDatabaseParams, NotionResponse> = {
  id: 'notion_create_database',
  name: 'Create Notion Database',
  description: 'Create a new database in Notion with custom properties',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'notion',
    additionalScopes: ['workspace.content', 'page.write'],
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
      type: 'string',
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
      let parsedProperties

      // Handle properties - use provided JSON or default to Name property
      if (params.properties?.trim()) {
        try {
          parsedProperties = JSON.parse(params.properties)
        } catch (error) {
          throw new Error(
            `Invalid properties JSON: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      } else {
        // Default properties with a Name column
        parsedProperties = {
          Name: {
            title: {},
          },
        }
      }

      // Format parent ID
      const formattedParentId = params.parentId.replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
      )

      const body = {
        parent: {
          type: 'page_id',
          page_id: formattedParentId,
        },
        title: [
          {
            type: 'text',
            text: {
              content: params.title,
            },
          },
        ],
        properties: parsedProperties,
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

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to create Notion database'
  },
}
