import type { NotionCreatePageParams, NotionResponse } from '@/tools/notion/types'
import { PAGE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
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
      visibility: 'user-or-llm',
      description: 'The UUID of the parent Notion page where this page will be created',
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
      const body: any = {
        parent: {
          type: 'page_id',
          page_id: params.parentId,
        },
      }

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
      properties: {
        title: { type: 'string', description: 'Page title' },
        pageId: PAGE_OUTPUT_PROPERTIES.id,
        url: PAGE_OUTPUT_PROPERTIES.url,
        lastEditedTime: PAGE_OUTPUT_PROPERTIES.last_edited_time,
        createdTime: PAGE_OUTPUT_PROPERTIES.created_time,
      },
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionCreatePageV2Response {
  success: boolean
  output: {
    id: string
    title: string
    url: string
    created_time: string
    last_edited_time: string
  }
}

export const notionCreatePageV2Tool: ToolConfig<
  NotionCreatePageParams,
  NotionCreatePageV2Response
> = {
  id: 'notion_create_page_v2',
  name: 'Notion Page Creator',
  description: 'Create a new page in Notion',
  version: '2.0.0',
  oauth: notionCreatePageTool.oauth,
  params: notionCreatePageTool.params,
  request: notionCreatePageTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    let pageTitle = 'Untitled'

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
        id: data.id,
        title: pageTitle,
        url: data.url,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
      },
    }
  },

  outputs: {
    id: PAGE_OUTPUT_PROPERTIES.id,
    title: { type: 'string', description: 'Page title' },
    url: PAGE_OUTPUT_PROPERTIES.url,
    created_time: PAGE_OUTPUT_PROPERTIES.created_time,
    last_edited_time: PAGE_OUTPUT_PROPERTIES.last_edited_time,
  },
}
