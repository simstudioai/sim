import type { ToolConfig } from '../types'
import type { ConfluenceUpdateParams, ConfluenceUpdateResponse } from './types'

export const confluenceUpdateTool: ToolConfig<ConfluenceUpdateParams, ConfluenceUpdateResponse> = {
  id: 'confluence_update',
  name: 'Confluence Update',
  description: 'Update a Confluence page using the Confluence API.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Confluence page ID to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the page',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the page in Confluence storage format',
    },
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number of the page (required for preventing conflicts)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceUpdateParams) => {
      return '/api/tools/confluence/page'
    },
    method: 'PUT',
    headers: (params: ConfluenceUpdateParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceUpdateParams) => {
      const body: Record<string, any> = {
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        cloudId: params.cloudId,
        title: params.title,
        body: params.content
          ? {
              representation: 'storage',
              value: params.content,
            }
          : undefined,
        version: {
          number: params.version || 1,
          message: params.version ? 'Updated via Sim Studio' : 'Initial update via Sim Studio',
        },
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('Update tool error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      })
      console.error(
        errorData?.error ||
          `Failed to update Confluence page: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.id,
        title: data.title,
        body: data.body,
        success: true,
      },
    }
  },

  transformError: (error: any) => {
    return error.message || 'Failed to update Confluence page'
  },
}
