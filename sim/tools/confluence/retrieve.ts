import { ToolConfig } from '../types'
import { ConfluenceRetrieveResponse } from './types'
import { ConfluenceRetrieveParams } from './types'

export const confluenceRetrieveTool: ToolConfig<
  ConfluenceRetrieveParams,
  ConfluenceRetrieveResponse
> = {
  id: 'confluence_retrieve',
  name: 'Confluence Retrieve',
  description: 'Retrieve content from Confluence pages using the Confluence API.',
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
    pageId: {
      type: 'string',
      required: true,
      description: 'Confluence page ID to retrieve',
    },
  },

  request: {
    url: (params: ConfluenceRetrieveParams) => {
      return `https://${params.domain}/wiki/api/v2/pages/${params.pageId}?expand=body.view`
    },
    method: 'GET',
    headers: (params: ConfluenceRetrieveParams) => {
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

    const cleanContent = data.body.view.value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.id,
        content: cleanContent,
        title: data.title,
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Confluence retrieve failed'
    return message
  },
}
