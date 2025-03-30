import { ToolConfig, ToolResponse } from '../types'

export interface NotionReadParams {
  pageId: string
  apiKey: string
}

export interface NotionResponse extends ToolResponse {
  output: {
    content: string
    metadata?: {
      title?: string
      lastEditedTime?: string
      createdTime?: string
      url?: string
    }
  }
}

export const notionReadTool: ToolConfig<NotionReadParams, NotionResponse> = {
  id: 'notion_read',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
  version: '1.0.0',

  params: {
    pageId: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'The ID of the Notion page to read',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Notion API key',
    },
  },

  request: {
    url: (params: NotionReadParams) => {
      // Format page ID with hyphens if needed
      const formattedId = params.pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
      return `https://api.notion.com/v1/blocks/${formattedId}/children?page_size=100`
    },
    method: 'GET',
    headers: (params: NotionReadParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract text content from blocks
    const blocks = data.results || []
    const content = blocks
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return block.paragraph.rich_text.map((text: any) => text.plain_text).join('')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')

    return {
      success: response.ok,
      output: {
        content: content,
        metadata: {
          lastEditedTime: blocks[0]?.last_edited_time,
          createdTime: blocks[0]?.created_time,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to read Notion page'
  },
}
