import type {
  SharepointReadSiteResponse,
  SharepointSite,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

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
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
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
        // get all sites
        baseUrl = 'https://graph.microsoft.com/v1.0/sites?search=*'
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
  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to read SharePoint site(s)')
    }

    // Check if this is a search result (multiple sites) or single site
    if (data.value && Array.isArray(data.value)) {
      // Multiple sites from search
      return {
        success: true,
        output: {
          sites: data.value.map((site: SharepointSite) => ({
            id: site.id,
            name: site.name,
            displayName: site.displayName,
            webUrl: site.webUrl,
            description: site.description,
            createdDateTime: site.createdDateTime,
            lastModifiedDateTime: site.lastModifiedDateTime,
          })),
        },
      }
    }
    // Single site response
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
