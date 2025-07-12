import type { ToolConfig } from '../types'
import type { NotionResponse, NotionUpdatePageParams } from './types'

export const notionUpdatePageTool: ToolConfig<NotionUpdatePageParams, NotionResponse> = {
  id: 'notion_update_page',
  name: 'Notion Page Updater',
  description: 'Update properties of a Notion page',
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
      description: 'ID of the page to update',
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
      // Format page ID with hyphens if needed
      const formattedId = params.pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
      return `https://api.notion.com/v1/pages/${formattedId}`
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
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`Failed to update Notion page: ${errorData.message || 'Unknown error'}`)
    }

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

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to update Notion page properties'
  },
}
