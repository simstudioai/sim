import type { ToolConfig } from '../types'
import type { NotionResponse, NotionWriteParams } from './types'

export const notionWriteTool: ToolConfig<NotionWriteParams, NotionResponse> = {
  id: 'notion_write',
  name: 'Notion Content Appender',
  description: 'Append content to a Notion page',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the Notion page to append content to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to append to the page',
    },
  },

  request: {
    url: (params: NotionWriteParams) => {
      // Format page ID with hyphens if needed
      const formattedId = params.pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
      return `https://api.notion.com/v1/blocks/${formattedId}/children`
    },
    method: 'PATCH',
    headers: (params: NotionWriteParams) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionWriteParams) => ({
      children: [
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
      ],
    }),
  },

  transformResponse: async (response: Response) => {
    const _data = await response.json()
    return {
      success: response.ok,
      output: {
        content: 'Successfully appended content to Notion page',
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to append content to Notion page'
  },
}
