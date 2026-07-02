import { createLogger } from '@sim/logger'
import type {
  CanvasLayout,
  SharepointToolParams,
  SharepointUpdatePageResponse,
} from '@/tools/sharepoint/types'
import { optionalTrim } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointUpdatePage')

export const updatePageTool: ToolConfig<SharepointToolParams, SharepointUpdatePageResponse> = {
  id: 'sharepoint_update_page',
  name: 'Update SharePoint Page',
  description: 'Update the title and/or content of a SharePoint page',
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
    siteId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the SharePoint site (internal use)',
    },
    siteSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the SharePoint site',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the page to update. Example: a GUID like 12345678-1234-1234-1234-123456789012',
    },
    pageTitle: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The new title of the page',
    },
    pageContent: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'The new text content of the page. Replaces the entire canvas layout of the page.',
    },
  },

  request: {
    url: (params) => {
      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const pageId = optionalTrim(params.pageId)
      if (!pageId) throw new Error('pageId must be provided')
      return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/microsoft.graph.sitePage`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const pageTitle = optionalTrim(params.pageTitle)
      const pageContent = typeof params.pageContent === 'string' ? params.pageContent : undefined

      if (!pageTitle && !pageContent) {
        throw new Error('At least one of pageTitle or pageContent must be provided')
      }

      const pageData: {
        '@odata.type': string
        title?: string
        canvasLayout?: CanvasLayout
      } = {
        '@odata.type': '#microsoft.graph.sitePage',
      }
      if (pageTitle) pageData.title = pageTitle

      if (pageContent) {
        pageData.canvasLayout = {
          horizontalSections: [
            {
              layout: 'oneColumn',
              id: '1',
              emphasis: 'none',
              columns: [
                {
                  id: '1',
                  width: 12,
                  webparts: [
                    {
                      id: '6f9230af-2a98-4952-b205-9ede4f9ef548',
                      innerHtml: `<p>${pageContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`,
                    },
                  ],
                },
              ],
            },
          ],
        }
      }

      logger.info('Updating SharePoint page', {
        pageId: params.pageId,
        hasTitle: !!pageTitle,
        hasContent: !!pageContent,
      })

      return pageData
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('SharePoint page updated successfully', {
      pageId: data.id,
      pageName: data.name,
      pageTitle: data.title,
    })

    return {
      success: true,
      output: {
        page: {
          id: data.id,
          name: data.name,
          title: data.title || data.name,
          webUrl: data.webUrl,
          pageLayout: data.pageLayout,
          createdDateTime: data.createdDateTime,
          lastModifiedDateTime: data.lastModifiedDateTime,
        },
      },
    }
  },

  outputs: {
    page: {
      type: 'object',
      description: 'Updated SharePoint page information',
      properties: {
        id: { type: 'string', description: 'The unique ID of the page' },
        name: { type: 'string', description: 'The name of the page' },
        title: { type: 'string', description: 'The title of the page' },
        webUrl: { type: 'string', description: 'The URL to access the page' },
        pageLayout: { type: 'string', description: 'The layout type of the page' },
        createdDateTime: { type: 'string', description: 'When the page was created' },
        lastModifiedDateTime: { type: 'string', description: 'When the page was last modified' },
      },
    },
  },
}
