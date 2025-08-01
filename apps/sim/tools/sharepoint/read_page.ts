import type { SharepointReadPageResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

export const readPageTool: ToolConfig<SharepointToolParams, SharepointReadPageResponse> = {
  id: 'sharepoint_read_page',
  name: 'Read SharePoint Page',
  description: 'Read a specific page from a SharePoint site',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'sharepoint',
    additionalScopes: ['openid', 'profile', 'email', 'Sites.Read.All', 'offline_access'],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the SharePoint API',
    },
    siteSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the SharePoint site',
    },
    siteId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the SharePoint site (internal use)',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the page to read',
    },
    pageName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the page to read (alternative to pageId)',
    },
  },
  request: {
    url: (params) => {
      // Use specific site if provided, otherwise use root site
      const siteId = params.siteId || params.siteSelector || 'root'
      
      let baseUrl: string
      if (params.pageId) {
        // Read specific page by ID
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${params.pageId}`
      } else if (params.pageName) {
        // Search for page by name - we'll need to list pages and filter
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/microsoft.graph.sitePage`
      } else {
        throw new Error('Either pageId or pageName must be provided')
      }
      
      const url = new URL(baseUrl)
      
      // Use Microsoft Graph $select parameter to get page details
      url.searchParams.append(
        '$select',
        'id,name,title,webUrl,pageLayout,promotionKind,createdDateTime,lastModifiedDateTime,contentType'
      )

      // If searching by name, add filter
      if (params.pageName && !params.pageId) {
        url.searchParams.append('$filter', `name eq '${params.pageName}'`)
        url.searchParams.append('$top', '1')
      }

      // Expand content if we're getting a specific page
      if (params.pageId) {
        url.searchParams.append('$expand', 'canvasLayout')
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to read SharePoint page')
    }

    let pageData: any
    let contentData: any = { content: '' }

    if (params?.pageId) {
      // Direct page access
      pageData = data
      contentData = {
        content: data.canvasLayout ? JSON.stringify(data.canvasLayout, null, 2) : '',
        canvasLayout: data.canvasLayout,
      }
    } else {
      // Search result - take first match
      if (!data.value || data.value.length === 0) {
        throw new Error(`Page with name '${params?.pageName}' not found`)
      }
      pageData = data.value[0]
      
      // For search results, we need to make another call to get the content
      if (pageData.id) {
        const siteId = params?.siteId || params?.siteSelector || 'root'
        const contentUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${pageData.id}?$expand=canvasLayout`
        
        const contentResponse = await fetch(contentUrl, {
          headers: {
            Authorization: `Bearer ${params?.accessToken}`,
            Accept: 'application/json',
          },
        })
        
        if (contentResponse.ok) {
          const contentResult = await contentResponse.json()
          contentData = {
            content: contentResult.canvasLayout ? JSON.stringify(contentResult.canvasLayout, null, 2) : '',
            canvasLayout: contentResult.canvasLayout,
          }
        }
      }
    }

    return {
      success: true,
      output: {
        page: {
          id: pageData.id,
          name: pageData.name,
          title: pageData.title || pageData.name,
          webUrl: pageData.webUrl,
          pageLayout: pageData.pageLayout,
          promotionKind: pageData.promotionKind,
          createdDateTime: pageData.createdDateTime,
          lastModifiedDateTime: pageData.lastModifiedDateTime,
          contentType: pageData.contentType,
        },
        content: contentData,
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while reading the SharePoint page'
  },
}
