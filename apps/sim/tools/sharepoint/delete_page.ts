import type { SharepointDeletePageResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const deletePageTool: ToolConfig<SharepointToolParams, SharepointDeletePageResponse> = {
  id: 'sharepoint_delete_page',
  name: 'Delete SharePoint Page',
  description: 'Delete a page from a SharePoint site',
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
        'The ID of the page to delete. Example: a GUID like 12345678-1234-1234-1234-123456789012',
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const pageId = optionalTrim(params.pageId)
      if (!pageId) throw new Error('pageId must be provided')
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${encodeURIComponent(pageId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (_response: Response, params) => {
    return {
      success: true,
      output: {
        deleted: true,
        pageId: params?.pageId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the page was deleted' },
    pageId: { type: 'string', description: 'The ID of the deleted page' },
  },
}
