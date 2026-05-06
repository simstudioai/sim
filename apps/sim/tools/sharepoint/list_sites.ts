import type {
  SharepointReadSiteResponse,
  SharepointSite,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl, optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listSitesTool: ToolConfig<SharepointToolParams, SharepointReadSiteResponse> = {
  id: 'sharepoint_list_sites',
  name: 'List SharePoint Sites',
  description: 'List details of all SharePoint sites',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'sharepoint',
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
      description:
        'The group ID for accessing a group team site. Example: a GUID like 12345678-1234-1234-1234-123456789012',
    },
    nextPageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full @odata.nextLink URL from a previous Microsoft Graph page response',
    },
  },

  request: {
    url: (params) => {
      if (params.nextPageUrl) {
        return assertGraphNextPageUrl(params.nextPageUrl)
      }

      let baseUrl: string
      const groupId = optionalTrim(params.groupId)
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector)

      if (groupId) {
        baseUrl = `https://graph.microsoft.com/v1.0/groups/${groupId}/sites/root`
      } else if (siteId) {
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}`
      } else {
        baseUrl = 'https://graph.microsoft.com/v1.0/sites?search=*'
      }

      const url = new URL(baseUrl)

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

    if (data.value && Array.isArray(data.value)) {
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
          nextPageUrl: getGraphNextPageUrl(data as Record<string, unknown>),
        },
      }
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

  outputs: {
    site: {
      type: 'object',
      description: 'Information about the current SharePoint site',
      properties: {
        id: { type: 'string', description: 'The unique ID of the site' },
        name: { type: 'string', description: 'The name of the site' },
        displayName: { type: 'string', description: 'The display name of the site' },
        webUrl: { type: 'string', description: 'The URL to access the site' },
        description: { type: 'string', description: 'The description of the site' },
        createdDateTime: { type: 'string', description: 'When the site was created' },
        lastModifiedDateTime: { type: 'string', description: 'When the site was last modified' },
        isPersonalSite: { type: 'boolean', description: 'Whether this is a personal site' },
        root: {
          type: 'object',
          properties: {
            serverRelativeUrl: { type: 'string', description: 'Server relative URL' },
          },
        },
        siteCollection: {
          type: 'object',
          properties: {
            hostname: { type: 'string', description: 'Site collection hostname' },
          },
        },
      },
    },
    sites: {
      type: 'array',
      description: 'List of all accessible SharePoint sites',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The unique ID of the site' },
          name: { type: 'string', description: 'The name of the site' },
          displayName: { type: 'string', description: 'The display name of the site' },
          webUrl: { type: 'string', description: 'The URL to access the site' },
          description: { type: 'string', description: 'The description of the site' },
          createdDateTime: { type: 'string', description: 'When the site was created' },
          lastModifiedDateTime: { type: 'string', description: 'When the site was last modified' },
        },
      },
    },
    nextPageUrl: {
      type: 'string',
      description: 'Full Microsoft Graph @odata.nextLink URL for the next page of results',
      optional: true,
    },
  },
}
