import type { NotionReadParams, NotionResponse } from '@/tools/notion/types'
import { PAGE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionReadTool: ToolConfig<NotionReadParams, NotionResponse> = {
  id: 'notion_read',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
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
      description: 'The UUID of the Notion page to read',
    },
  },

  request: {
    url: (params: NotionReadParams) => {
      return `https://api.notion.com/v1/pages/${params.pageId}`
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

    // Fetch page content using blocks endpoint
    const blocksResponse = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
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

  outputs: {
    content: {
      type: 'string',
      description: 'Page content in markdown format with headers, paragraphs, lists, and todos',
    },
    metadata: {
      type: 'object',
      description: 'Page metadata including title, URL, and timestamps',
      properties: {
        title: { type: 'string', description: 'Page title' },
        lastEditedTime: { type: 'string', description: 'ISO 8601 last edit timestamp' },
        createdTime: { type: 'string', description: 'ISO 8601 creation timestamp' },
        url: { type: 'string', description: 'Notion page URL' },
      },
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionReadV2Response {
  success: boolean
  output: {
    content: string
    title: string
    url: string
    created_time: string
    last_edited_time: string
  }
}

export const notionReadV2Tool: ToolConfig<NotionReadParams, NotionReadV2Response> = {
  id: 'notion_read_v2',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
  version: '2.0.0',
  oauth: notionReadTool.oauth,
  params: notionReadTool.params,
  request: notionReadTool.request,

  transformResponse: async (response: Response, params?: NotionReadParams) => {
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

    const pageId = params?.pageId
    const accessToken = params?.accessToken

    if (!pageId || !accessToken) {
      return {
        success: true,
        output: {
          content: '',
          title: pageTitle,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    }

    const blocksResponse = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
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
      return {
        success: true,
        output: {
          content: '',
          title: pageTitle,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    }

    const blocksData = await blocksResponse.json()
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
        content,
        title: pageTitle,
        url: data.url,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Page content in markdown format' },
    title: { type: 'string', description: 'Page title' },
    url: PAGE_OUTPUT_PROPERTIES.url,
    created_time: PAGE_OUTPUT_PROPERTIES.created_time,
    last_edited_time: PAGE_OUTPUT_PROPERTIES.last_edited_time,
  },
}
