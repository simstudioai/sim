import type { NotionResponse, NotionUpdatePageParams } from '@/tools/notion/types'
import { PAGE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import type { ToolConfig } from '@/tools/types'

export const notionUpdatePageTool: ToolConfig<NotionUpdatePageParams, NotionResponse> = {
  id: 'notion_update_page',
  name: 'Notion Page Updater',
  description: 'Update properties of a Notion page',
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
      description: 'The UUID of the Notion page to update',
    },
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object of properties to update',
    },
  },

  request: {
    url: (params: NotionUpdatePageParams) => {
      return `https://api.notion.com/v1/pages/${params.pageId}`
    },
    method: 'PATCH',
    headers: (params: NotionUpdatePageParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
    body: (params: NotionUpdatePageParams) => ({
      properties: params.properties,
    }),
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
        content: 'Successfully updated page properties',
        metadata: {
          title: pageTitle,
          pageId: data.id,
          url: data.url,
          lastEditedTime: data.last_edited_time,
          updatedTime: new Date().toISOString(),
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Success message confirming page properties update',
    },
    metadata: {
      type: 'object',
      description: 'Page metadata including title, page ID, URL, and update timestamps',
      properties: {
        title: { type: 'string', description: 'Page title' },
        pageId: PAGE_OUTPUT_PROPERTIES.id,
        url: PAGE_OUTPUT_PROPERTIES.url,
        lastEditedTime: PAGE_OUTPUT_PROPERTIES.last_edited_time,
        updatedTime: {
          type: 'string',
          description: 'ISO 8601 timestamp when update was performed',
        },
      },
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionUpdatePageV2Response {
  success: boolean
  output: {
    id: string
    title: string
    url: string
    last_edited_time: string
  }
}

export const notionUpdatePageV2Tool: ToolConfig<
  NotionUpdatePageParams,
  NotionUpdatePageV2Response
> = {
  id: 'notion_update_page_v2',
  name: 'Notion Page Updater',
  description: 'Update properties of a Notion page',
  version: '2.0.0',
  oauth: notionUpdatePageTool.oauth,
  params: notionUpdatePageTool.params,
  request: notionUpdatePageTool.request,

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
        last_edited_time: data.last_edited_time,
      },
    }
  },

  outputs: {
    id: PAGE_OUTPUT_PROPERTIES.id,
    title: { type: 'string', description: 'Page title' },
    url: PAGE_OUTPUT_PROPERTIES.url,
    last_edited_time: PAGE_OUTPUT_PROPERTIES.last_edited_time,
  },
}
