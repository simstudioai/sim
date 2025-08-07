import { createLogger } from '@/lib/logs/console/logger'
import type {
  GraphApiResponse,
  SharepointPageContent,
  SharepointReadPageResponse,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import { cleanODataMetadata, extractTextFromCanvasLayout } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointReadPage')

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
      required: false,
      visibility: 'user-only',
      description: 'The ID of the page to read',
    },
    pageName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the page to read (alternative to pageId)',
    },
    maxPages: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description:
        'Maximum number of pages to return when listing all pages (default: 10, max: 50)',
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
      } else {
        // List all pages (with optional filtering by name)
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages`
      }

      const url = new URL(baseUrl)

      // Use Microsoft Graph $select parameter to get page details
      // Only include valid properties for SharePoint pages
      url.searchParams.append(
        '$select',
        'id,name,title,webUrl,pageLayout,createdDateTime,lastModifiedDateTime'
      )

      // If searching by name, add filter
      if (params.pageName && !params.pageId) {
        // Try to handle both with and without .aspx extension
        const pageName = params.pageName
        const pageNameWithAspx = pageName.endsWith('.aspx') ? pageName : `${pageName}.aspx`

        // Search for exact match first, then with .aspx if needed
        url.searchParams.append('$filter', `name eq '${pageName}' or name eq '${pageNameWithAspx}'`)
        url.searchParams.append('$top', '10') // Get more results to find matches
      } else if (!params.pageId && !params.pageName) {
        // When listing all pages, apply maxPages limit
        const maxPages = Math.min(params.maxPages || 10, 50) // Default 10, max 50
        url.searchParams.append('$top', maxPages.toString())
      }

      // Only expand content when getting a specific page by ID
      if (params.pageId) {
        url.searchParams.append('$expand', 'canvasLayout')
      }

      const finalUrl = url.toString()

      logger.info('SharePoint API URL', {
        finalUrl,
        siteId,
        pageId: params.pageId,
        pageName: params.pageName,
        searchParams: Object.fromEntries(url.searchParams),
      })

      return finalUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response, params) => {
    const data: GraphApiResponse = await response.json()

    if (!response.ok) {
      logger.error('SharePoint API error', {
        status: response.status,
        statusText: response.statusText,
        error: data.error,
        data,
      })
      throw new Error(data.error?.message || 'Failed to read SharePoint page')
    }

    logger.info('SharePoint API response', {
      pageId: params?.pageId,
      pageName: params?.pageName,
      resultsCount: data.value?.length || (data.id ? 1 : 0),
      hasDirectPage: !!data.id,
      hasSearchResults: !!data.value,
    })

    if (params?.pageId) {
      // Direct page access - return single page
      const pageData = data
      const contentData = {
        content: extractTextFromCanvasLayout(data.canvasLayout),
        canvasLayout: data.canvasLayout as any,
      }

      return {
        success: true,
        output: {
          page: {
            id: pageData.id!,
            name: pageData.name!,
            title: pageData.title || pageData.name!,
            webUrl: pageData.webUrl!,
            pageLayout: pageData.pageLayout,
            createdDateTime: pageData.createdDateTime,
            lastModifiedDateTime: pageData.lastModifiedDateTime,
          },
          content: contentData,
        },
      }
    }
    // Multiple pages or search by name
    if (!data.value || data.value.length === 0) {
      logger.error('No pages found', {
        searchName: params?.pageName,
        siteId: params?.siteId || params?.siteSelector || 'root',
        totalResults: data.value?.length || 0,
      })
      const errorMessage = params?.pageName
        ? `Page with name '${params?.pageName}' not found. Make sure the page exists and you have access to it. Note: SharePoint page names typically include the .aspx extension.`
        : 'No pages found on this SharePoint site.'
      throw new Error(errorMessage)
    }

    logger.info('Found pages', {
      searchName: params?.pageName,
      foundPages: data.value.map((p: any) => ({ id: p.id, name: p.name, title: p.title })),
      totalCount: data.value.length,
    })

    if (params?.pageName) {
      // Search by name - return single page (first match)
      const pageData = data.value[0]
      const siteId = params?.siteId || params?.siteSelector || 'root'
      const contentUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${pageData.id}/microsoft.graph.sitePage?$expand=canvasLayout`

      logger.info('Making API call to get page content for searched page', {
        pageId: pageData.id,
        contentUrl,
        siteId,
      })

      const contentResponse = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${params?.accessToken}`,
          Accept: 'application/json',
        },
      })

      let contentData: SharepointPageContent = { content: '' }
      if (contentResponse.ok) {
        const contentResult = await contentResponse.json()
        contentData = {
          content: extractTextFromCanvasLayout(contentResult.canvasLayout),
          canvasLayout: cleanODataMetadata(contentResult.canvasLayout),
        }
      } else {
        logger.error('Failed to fetch page content', {
          status: contentResponse.status,
          statusText: contentResponse.statusText,
        })
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
            createdDateTime: pageData.createdDateTime,
            lastModifiedDateTime: pageData.lastModifiedDateTime,
          },
          content: contentData,
        },
      }
    }
    // List all pages - return multiple pages with content
    const siteId = params?.siteId || params?.siteSelector || 'root'
    const pagesWithContent = []

    logger.info('Fetching content for all pages', {
      totalPages: data.value.length,
      siteId,
    })

    // Fetch content for each page
    for (const pageInfo of data.value) {
      const contentUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${pageInfo.id}/microsoft.graph.sitePage?$expand=canvasLayout`

      try {
        const contentResponse = await fetch(contentUrl, {
          headers: {
            Authorization: `Bearer ${params?.accessToken}`,
            Accept: 'application/json',
          },
        })

        let contentData = { content: '', canvasLayout: null }
        if (contentResponse.ok) {
          const contentResult = await contentResponse.json()
          contentData = {
            content: extractTextFromCanvasLayout(contentResult.canvasLayout),
            canvasLayout: cleanODataMetadata(contentResult.canvasLayout),
          }
        } else {
          logger.error('Failed to fetch content for page', {
            pageId: pageInfo.id,
            pageName: pageInfo.name,
            status: contentResponse.status,
          })
        }

        pagesWithContent.push({
          page: {
            id: pageInfo.id,
            name: pageInfo.name,
            title: pageInfo.title || pageInfo.name,
            webUrl: pageInfo.webUrl,
            pageLayout: pageInfo.pageLayout,
            createdDateTime: pageInfo.createdDateTime,
            lastModifiedDateTime: pageInfo.lastModifiedDateTime,
          },
          content: contentData,
        })
      } catch (error) {
        logger.error('Error fetching content for page', {
          pageId: pageInfo.id,
          pageName: pageInfo.name,
          error: error instanceof Error ? error.message : String(error),
        })

        // Still add the page without content
        pagesWithContent.push({
          page: {
            id: pageInfo.id,
            name: pageInfo.name,
            title: pageInfo.title || pageInfo.name,
            webUrl: pageInfo.webUrl,
            pageLayout: pageInfo.pageLayout,
            createdDateTime: pageInfo.createdDateTime,
            lastModifiedDateTime: pageInfo.lastModifiedDateTime,
          },
          content: { content: 'Failed to fetch content', canvasLayout: null },
        })
      }
    }

    logger.info('Completed fetching content for all pages', {
      totalPages: pagesWithContent.length,
      successfulPages: pagesWithContent.filter(
        (p) => p.content.content !== 'Failed to fetch content'
      ).length,
    })

    return {
      success: true,
      output: {
        pages: pagesWithContent,
        totalPages: pagesWithContent.length,
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while reading the SharePoint page'
  },
}
