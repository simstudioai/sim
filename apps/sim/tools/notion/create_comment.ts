import type { NotionCreateCommentParams } from '@/tools/notion/types'
import { RICH_TEXT_ARRAY_OUTPUT } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

interface NotionCreateCommentResponse {
  success: boolean
  output: {
    id: string
    discussion_id: string
    created_time: string
    content: string
    rich_text: any[]
  }
}

export const notionCreateCommentTool: ToolConfig<
  NotionCreateCommentParams,
  NotionCreateCommentResponse
> = {
  id: 'notion_create_comment',
  name: 'Notion Create Comment',
  description: 'Create a comment on a Notion page or within an existing discussion thread',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the page to comment on (provide either pageId or discussionId)',
    },
    discussionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of an existing discussion thread to reply to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of the comment',
    },
  },

  request: {
    url: () => 'https://api.notion.com/v1/comments',
    method: 'POST',
    headers: (params: NotionCreateCommentParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionCreateCommentParams) => {
      const pageId = params.pageId?.trim()
      const discussionId = params.discussionId?.trim()

      if (!pageId && !discussionId) {
        throw new Error('Either pageId or discussionId is required to create a comment')
      }

      const body: any = {
        rich_text: [{ type: 'text', text: { content: params.content } }],
      }

      if (discussionId) {
        body.discussion_id = discussionId
      } else {
        body.parent = { page_id: pageId }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const richText = data.rich_text ?? []
    return {
      success: response.ok,
      output: {
        id: data.id,
        discussion_id: data.discussion_id ?? '',
        created_time: data.created_time ?? '',
        content: richText.map((t: any) => t.plain_text ?? '').join(''),
        rich_text: richText,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Comment UUID' },
    discussion_id: { type: 'string', description: 'UUID of the discussion thread' },
    created_time: { type: 'string', description: 'ISO 8601 creation timestamp' },
    content: { type: 'string', description: 'Plain text content of the comment' },
    rich_text: RICH_TEXT_ARRAY_OUTPUT,
  },
}

export const notionCreateCommentV2Tool: ToolConfig<
  NotionCreateCommentParams,
  NotionCreateCommentResponse
> = {
  id: 'notion_create_comment_v2',
  name: 'Notion Create Comment',
  description: 'Create a comment on a Notion page or within an existing discussion thread',
  version: '2.0.0',
  oauth: notionCreateCommentTool.oauth,
  params: notionCreateCommentTool.params,
  request: notionCreateCommentTool.request,
  transformResponse: notionCreateCommentTool.transformResponse,
  outputs: notionCreateCommentTool.outputs,
}
