import type { ToolConfig } from '../types'
import type { ConfluenceRetrieveParams, ConfluenceRetrieveResponse } from './types'

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
      description: 'Confluence page ID to retrieve',
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
    url: (params: ConfluenceRetrieveParams) => {
      // Instead of calling Confluence API directly, use your API route
      return '/api/tools/confluence/page'
    },
    method: 'POST',
    headers: (params: ConfluenceRetrieveParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceRetrieveParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        pageId: params.pageId,
        cloudId: params.cloudId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        errorData?.error ||
          `Failed to retrieve Confluence page: ${response.status} ${response.statusText}`
      )
    }

    const data = await response.json()
    return transformPageData(data)
  },

  transformError: (error: any) => {
    return error.message || 'Failed to retrieve Confluence page'
  },
}

function transformPageData(data: any) {
  // More lenient check - only require id and title
  if (!data || !data.id || !data.title) {
    throw new Error('Invalid response format from Confluence API - missing required fields')
  }

  // Get content from wherever we can find it
  const content =
    data.body?.view?.value ||
    data.body?.storage?.value ||
    data.body?.atlas_doc_format?.value ||
    data.content ||
    data.description ||
    `Content for page ${data.title}`

  const cleanContent = content
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
}
