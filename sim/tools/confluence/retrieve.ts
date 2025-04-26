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
    cloudId: {
      type: 'string',
      required: false,
      description: 'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceRetrieveParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/confluence/${params.cloudId}/rest/api/content/${params.pageId}?expand=body.view`
      }
      // If no cloudId, use the accessible resources endpoint
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: ConfluenceRetrieveParams) => {
      return {
        'Accept': 'application/json',
        'Authorization': `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: ConfluenceRetrieveParams) => {
    if (!params) {
      throw new Error('Parameters are required for Confluence page retrieval')
    }

    try {
      // If we don't have a cloudId, we need to fetch it first
      if (!params.cloudId) {
        if (!response.ok) {
          const errorData = await response.json().catch(() => null)
          throw new Error(errorData?.message || `Failed to fetch accessible resources: ${response.status} ${response.statusText}`)
        }

        const accessibleResources = await response.json()
        if (!Array.isArray(accessibleResources) || accessibleResources.length === 0) {
          throw new Error('No accessible Confluence resources found for this account')
        }

        const normalizedInput = `https://${params.domain}`.toLowerCase()
        const matchedResource = accessibleResources.find(r => r.url.toLowerCase() === normalizedInput)

        if (!matchedResource) {
          throw new Error(`Could not find matching Confluence site for domain: ${params.domain}`)
        }

        // Now fetch the actual page with the found cloudId
        const pageUrl = `https://api.atlassian.com/ex/confluence/${matchedResource.id}/rest/api/content/${params.pageId}?expand=body.view`
        const pageResponse = await fetch(pageUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${params.accessToken}`,
          }
        })

        if (!pageResponse.ok) {
          const errorData = await pageResponse.json().catch(() => null)
          throw new Error(errorData?.message || `Failed to retrieve Confluence page: ${pageResponse.status} ${pageResponse.statusText}`)
        }

        const data = await pageResponse.json()
        return transformPageData(data)
      }

      // If we have a cloudId, this response is the page data
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.message || `Failed to retrieve Confluence page: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      return transformPageData(data)
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
  },

  transformError: (error: any) => {
    return error.message || 'Failed to retrieve Confluence page'
  },
}

function transformPageData(data: any) {
  if (!data || !data.body?.view?.value) {
    throw new Error('Invalid response format from Confluence API')
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
}
