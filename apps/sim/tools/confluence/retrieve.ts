import type { ConfluenceRetrieveParams, ConfluenceRetrieveResponse } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

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

  outputs: {
    ts: { type: 'string', description: 'Timestamp of retrieval' },
    pageId: { type: 'string', description: 'Confluence page ID' },
    content: { type: 'string', description: 'Page content with HTML tags stripped' },
    title: { type: 'string', description: 'Page title' },
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
    const data = await response.json()
    return transformPageData(data)
  },

  transformError: (error: Error) => {
    return `Confluence API Error: ${error.message}`
  },
}

function transformPageData(data: any) {
  // Get content from wherever we can find it
  const content =
    data.body?.view?.value ||
    data.body?.storage?.value ||
    data.body?.atlas_doc_format?.value ||
    data.content ||
    data.description ||
    `Content for page ${data.title || 'Unknown'}`

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
      pageId: data.id || '',
      content: cleanContent,
      title: data.title || '',
    },
  }
}
