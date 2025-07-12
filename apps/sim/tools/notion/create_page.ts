import type { ToolConfig } from '../types'
import type { NotionCreatePageParams, NotionResponse } from './types'

export const notionCreatePageTool: ToolConfig<NotionCreatePageParams, NotionResponse> = {
  id: 'notion_create_page',
  name: 'Notion Page Creator',
  description: 'Create a new page in Notion',
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
    parentType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Type of parent: "page" or "database"',
    },
    parentId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the parent page or database',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title of the page (required for parent pages, not for databases)',
    },
    properties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of properties for database pages',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional content to add to the page upon creation',
    },
  },

  request: {
    url: () => 'https://api.notion.com/v1/pages',
    method: 'POST',
    headers: (params: NotionCreatePageParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionCreatePageParams) => {
      // Format parent ID with hyphens if needed
      const formattedParentId = params.parentId.replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
      )

      // Prepare the body based on parent type
      const body: any = {
        parent: {
          type: params.parentType === 'page' ? 'page_id' : 'database_id',
          [params.parentType === 'page' ? 'page_id' : 'database_id']: formattedParentId,
        },
      }

      // For child pages, properties only have title
      if (params.parentType === 'page' && params.title) {
        body.properties = {
          title: {
            type: 'title',
            title: [
              {
                type: 'text',
                text: {
                  content: params.title,
                },
              },
            ],
          },
        }
      }
      // For database pages, use the provided properties
      else if (params.parentType === 'database' && params.properties) {
        body.properties = params.properties
      }
      // If neither, add an empty properties object
      else {
        body.properties = {}
      }

      // Add content if provided
      if (params.content) {
        body.children = [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: params.content,
                  },
                },
              ],
            },
          },
        ]
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Failed to create Notion page: ${errorData.message || 'Unknown error'}`)
    }

    const data = await response.json()
    let pageTitle = 'Untitled'

    // Try to extract the title from properties
    if (data.properties?.title) {
      const titleProperty = data.properties.title
      if (
        titleProperty.title &&
        Array.isArray(titleProperty.title) &&
        titleProperty.title.length > 0
      ) {
        pageTitle = titleProperty.title.map((t: any) => t.plain_text || '').join('')
      }
    }

    return {
      success: true,
      output: {
        content: `Successfully created page "${pageTitle}"`,
        metadata: {
          title: pageTitle,
          pageId: data.id,
          url: data.url,
          lastEditedTime: data.last_edited_time,
          createdTime: data.created_time,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to create Notion page'
  },
}
