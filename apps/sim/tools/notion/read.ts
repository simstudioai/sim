import type { ToolConfig } from '../types'
import type { NotionReadParams, NotionResponse } from './types'

export const notionReadTool: ToolConfig<NotionReadParams, NotionResponse> = {
  id: 'notion_read',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'notion',
    additionalScopes: ['workspace.content', 'page.read'],
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
      description: 'The ID of the Notion page to read',
    },
  },

  request: {
    url: (params: NotionReadParams) => {
      // Format page ID with hyphens if needed
      const formattedId = params.pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

      // Use the page endpoint to get page properties
      return `https://api.notion.com/v1/pages/${formattedId}`
    },
    method: 'GET',
    headers: (params: NotionReadParams) => {
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
  },

  transformResponse: async (response: Response, params?: NotionReadParams) => {
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Notion API error: ${errorData.message || 'Unknown error'}`)
    }

    const data = await response.json()
    let pageTitle = 'Untitled'

    // Extract title from properties
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

    // Now fetch the page content using blocks endpoint
    const pageId = params?.pageId
    const accessToken = params?.accessToken

    if (!pageId || !accessToken) {
      return {
        success: true,
        output: {
          content: '',
          metadata: {
            title: pageTitle,
            lastEditedTime: data.last_edited_time,
            createdTime: data.created_time,
            url: data.url,
          },
        },
      }
    }

    // Format page ID for blocks endpoint
    const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

    // Fetch page content using blocks endpoint
    const blocksResponse = await fetch(
      `https://api.notion.com/v1/blocks/${formattedId}/children?page_size=100`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!blocksResponse.ok) {
      // If we can't get blocks, still return the page metadata
      return {
        success: true,
        output: {
          content: '',
          metadata: {
            title: pageTitle,
            lastEditedTime: data.last_edited_time,
            createdTime: data.created_time,
            url: data.url,
          },
        },
      }
    }

    const blocksData = await blocksResponse.json()

    // Extract text content from blocks
    const blocks = blocksData.results || []
    const content = blocks
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return block.paragraph.rich_text.map((text: any) => text.plain_text).join('')
        }
        if (block.type === 'heading_1') {
          return `# ${block.heading_1.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        if (block.type === 'heading_2') {
          return `## ${block.heading_2.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        if (block.type === 'heading_3') {
          return `### ${block.heading_3.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        if (block.type === 'bulleted_list_item') {
          return `• ${block.bulleted_list_item.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        if (block.type === 'numbered_list_item') {
          return `1. ${block.numbered_list_item.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        if (block.type === 'to_do') {
          const checked = block.to_do.checked ? '[x]' : '[ ]'
          return `${checked} ${block.to_do.rich_text.map((text: any) => text.plain_text).join('')}`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')

    return {
      success: true,
      output: {
        content: content,
        metadata: {
          title: pageTitle,
          lastEditedTime: data.last_edited_time,
          createdTime: data.created_time,
          url: data.url,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to read Notion page'
  },
}
