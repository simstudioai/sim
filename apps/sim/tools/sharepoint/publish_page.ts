import type { SharepointPublishPageResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const publishPageTool: ToolConfig<SharepointToolParams, SharepointPublishPageResponse> = {
  id: 'sharepoint_publish_page',
  name: 'Publish SharePoint Page',
  description: 'Publish the latest version of a SharePoint page, making it available to all users',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the page to publish. Example: a GUID like 12345678-1234-1234-1234-123456789012',
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const pageId = optionalTrim(params.pageId)
      if (!pageId) throw new Error('pageId must be provided')
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${encodeURIComponent(pageId)}/microsoft.graph.sitePage/publish`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (_response: Response, params) => {
    return {
      success: true,
      output: {
        published: true,
        pageId: params?.pageId ?? '',
      },
    }
  },

  outputs: {
    published: { type: 'boolean', description: 'Whether the page was published' },
    pageId: { type: 'string', description: 'The ID of the published page' },
  },
}
