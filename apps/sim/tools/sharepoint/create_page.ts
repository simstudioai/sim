import { createLogger } from '@/lib/logs/console/logger'
import type {
  SharepointCreatePageResponse,
  SharepointPage,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointCreatePage')

export const createPageTool: ToolConfig<SharepointToolParams, SharepointCreatePageResponse> = {
  id: 'sharepoint_create_page',
  name: 'Create SharePoint Page',
  description: 'Create a new page in a SharePoint site',
  version: '1.0',

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
    pageName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the page to create',
    },
    pageTitle: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The title of the page (defaults to page name if not provided)',
    },
    pageContent: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The content of the page',
    },
  },

  request: {
    url: (params) => {
      // Use specific site if provided, otherwise use root site
      const siteId = params.siteSelector || params.siteId || 'root'
      return `https://graph.microsoft.com/v1.0/sites/${siteId}/pages`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.pageName) {
        throw new Error('Page name is required')
      }

      const pageTitle = params.pageTitle || params.pageName

      // Basic page structure required by Microsoft Graph API
      const pageData: SharepointPage = {
        '@odata.type': '#microsoft.graph.sitePage',
        name: params.pageName,
        title: pageTitle,
        publishingState: {
          level: 'draft',
        },
        pageLayout: 'article',
      }

      // Add content if provided using the simple innerHtml approach from the documentation
      if (params.pageContent) {
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
                      innerHtml: `<p>${params.pageContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`,
                    },
                  ],
                },
              ],
            },
          ],
        }
      }

      return pageData
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('SharePoint page created successfully', {
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
      description: 'Created SharePoint page information',
      properties: {
        id: { type: 'string', description: 'The unique ID of the created page' },
        name: { type: 'string', description: 'The name of the created page' },
        title: { type: 'string', description: 'The title of the created page' },
        webUrl: { type: 'string', description: 'The URL to access the page' },
        pageLayout: { type: 'string', description: 'The layout type of the page' },
        createdDateTime: { type: 'string', description: 'When the page was created' },
        lastModifiedDateTime: { type: 'string', description: 'When the page was last modified' },
      },
    },
  },
}
