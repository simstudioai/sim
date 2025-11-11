import type { NotionCreatePageParams, NotionResponse } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionCreatePageTool: ToolConfig<NotionCreatePageParams, NotionResponse> = {
  id: 'notion_create_page',
  name: 'Notion Page Creator',
  description: 'Create a new page in Notion',
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
      visibility: 'user-only',
      description: 'ID of the parent page',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title of the new page',
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

      // Prepare the body for page parent
      const body: any = {
        parent: {
          type: 'page_id',
          page_id: formattedParentId,
        },
      }

      // Add title if provided
      if (params.title) {
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
      } else {
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

  outputs: {
    content: {
      type: 'string',
      description: 'Success message confirming page creation',
    },
    metadata: {
      type: 'object',
      description: 'Page metadata including title, page ID, URL, and timestamps',
    },
  },
}
