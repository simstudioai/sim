import { ToolConfig } from '../types'
import { ConfluenceUpdateParams, ConfluenceUpdateResponse } from './types'

export const confluenceUpdateTool: ToolConfig<ConfluenceUpdateParams, ConfluenceUpdateResponse> = {
  id: 'confluence_update',
  name: 'Confluence Update',
  description: 'Update a Confluence page using the Confluence API.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
    additionalScopes: [
      'read:confluence-content.all',
      'write:confluence-content',
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
    pageId: {
      type: 'string',
      required: true,
      description: 'Confluence page ID to update',
    },
    title: {
      type: 'string',
      required: false,
      description: 'New title for the page',
    },
    content: {
      type: 'string',
      required: false,
      description: 'New content for the page in Confluence storage format',
    },
    version: {
      type: 'number',
      required: false,
      description: 'Version number of the page (required for preventing conflicts)',
    },
  },

  request: {
    url: (params: ConfluenceUpdateParams) => {
      return `https://${params.domain}/wiki/api/v2/pages/${params.pageId}`
    },
    method: 'PUT',
    headers: (params: ConfluenceUpdateParams) => {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceUpdateParams) => {
      const body: Record<string, any> = {}

      if (params.title) {
        body.title = params.title
      }

      if (params.content) {
        body.body = {
          representation: 'storage',
          value: params.content,
        }
      }

      if (params.version) {
        body.version = {
          number: params.version,
          message: 'Updated via Sim Studio',
        }
      }

      return body
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
        pageId: data.id,
        title: data.title,
        success: true,
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Confluence update failed'
    return message
  },
}
