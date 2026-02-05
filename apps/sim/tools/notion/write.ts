import type { NotionResponse, NotionWriteParams } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionWriteTool: ToolConfig<NotionWriteParams, NotionResponse> = {
  id: 'notion_write',
  name: 'Notion Content Appender',
  description: 'Append content to a Notion page',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Notion page to append content to',
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
      return `https://api.notion.com/v1/blocks/${params.pageId}/children`
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

  outputs: {
    content: {
      type: 'string',
      description: 'Success message confirming content was appended to page',
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionWriteV2Response {
  success: boolean
  output: {
    appended: boolean
  }
}

export const notionWriteV2Tool: ToolConfig<NotionWriteParams, NotionWriteV2Response> = {
  id: 'notion_write_v2',
  name: 'Notion Content Appender',
  description: 'Append content to a Notion page',
  version: '2.0.0',
  oauth: notionWriteTool.oauth,
  params: notionWriteTool.params,
  request: notionWriteTool.request,

  transformResponse: async (response: Response) => {
    await response.json()
    return {
      success: response.ok,
      output: {
        appended: response.ok,
      },
    }
  },

  outputs: {
    appended: { type: 'boolean', description: 'Whether content was successfully appended' },
  },
}
