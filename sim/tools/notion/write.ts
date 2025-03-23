import { ToolConfig } from '../types'
import { NotionResponse } from './read'

export interface NotionWriteParams {
  pageId: string
  content: string
  apiKey: string
}

export const notionWriteTool: ToolConfig<NotionWriteParams, NotionResponse> = {
  id: 'notion_write',
  name: 'Notion Writer',
  description: 'Write content to a Notion page',
  version: '1.0.0',

  params: {
    pageId: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'The ID of the Notion page to write to',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The content to write to the page',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Notion API key',
    },
  },

  request: {
    url: (params: NotionWriteParams) => {
      // Format page ID with hyphens if needed
      const formattedId = params.pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
      return `https://api.notion.com/v1/blocks/${formattedId}/children`
    },
    method: 'PATCH',
    headers: (params: NotionWriteParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }),
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
    const data = await response.json()
    return {
      success: response.ok,
      output: {
        content: 'Successfully appended content to Notion page',
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to write to Notion page'
  },
}
