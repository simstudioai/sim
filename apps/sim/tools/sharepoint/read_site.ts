import type { SharepointToolParams } from '@/tools/sharepoint/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SharepointReadSiteResponse extends ToolResponse {
  output: {
    site: {
      id: string
      name: string
      displayName: string
      webUrl: string
      description?: string
      createdDateTime?: string
      lastModifiedDateTime?: string
      isPersonalSite?: boolean
      root?: {
        serverRelativeUrl: string
      }
      siteCollection?: {
        hostname: string
      }
    }
  }
}

export const listSitesTool: ToolConfig<SharepointToolParams, SharepointReadSiteResponse> = {
  id: 'sharepoint_list_sites',
  name: 'List SharePoint Sites',
  description: 'List details of all SharePoint sites',
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
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group ID for accessing a group team site',
    },
  },
  request: {
    url: (params) => {
      let baseUrl: string
      
      if (params.groupId) {
        // Access group team site
        baseUrl = `https://graph.microsoft.com/v1.0/groups/${params.groupId}/sites/root`
      } else if (params.siteId || params.siteSelector) {
        // Access specific site by ID
        const siteId = params.siteId || params.siteSelector
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}`
      } else {
        // Default to root site
        baseUrl = 'https://graph.microsoft.com/v1.0/sites/root'
      }
      
      const url = new URL(baseUrl)
      
      // Use Microsoft Graph $select parameter to get site details
      url.searchParams.append(
        '$select',
        'id,name,displayName,webUrl,description,createdDateTime,lastModifiedDateTime,isPersonalSite,root,siteCollection'
      )

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to read SharePoint site')
    }

    return {
      success: true,
      output: {
        site: {
          id: data.id,
          name: data.name,
          displayName: data.displayName,
          webUrl: data.webUrl,
          description: data.description,
          createdDateTime: data.createdDateTime,
          lastModifiedDateTime: data.lastModifiedDateTime,
          isPersonalSite: data.isPersonalSite,
          root: data.root,
          siteCollection: data.siteCollection,
        },
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while reading the SharePoint site'
  },
}
