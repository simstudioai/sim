import { ToolConfig } from '../types'
import { ConfluenceListParams, ConfluenceListResponse } from './types'

export const confluenceListTool: ToolConfig<ConfluenceListParams, ConfluenceListResponse> = {
  id: 'confluence_list',
  name: 'Confluence List Pages',
  description: 'List pages from Confluence using the Confluence API.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
    additionalScopes: [
      'read:page:confluence',
      'read:confluence-content.all',
      'read:me',
      'offline_access',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of pages to return (default: 25, max: 100)',
    },
    spaceKey: {
      type: 'string',
      required: false,
      description: 'Filter pages by space key',
    },
    title: {
      type: 'string',
      required: false,
      description: 'Filter pages by title',
    },
  },

  request: {
    url: (params: ConfluenceListParams) => {
      const baseUrl = `https://${params.domain}/wiki/api/v2/pages`
      const queryParams = new URLSearchParams()

      if (params.limit) {
        queryParams.append('limit', params.limit.toString())
      }

      if (params.spaceKey) {
        queryParams.append('space-id', params.spaceKey)
      }

      if (params.title) {
        queryParams.append('title', params.title)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params: ConfluenceListParams) => {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || 'Confluence API error')
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pages: data.results.map((page: any) => ({
          id: page.id,
          title: page.title,
          spaceKey: page.spaceKey,
          url: page._links?.webui || '',
          lastModified: page.version?.when || '',
        })),
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Confluence list pages failed'
    return message
  },
}
