import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type {
  GraphApiPageFields,
  GraphApiResponse,
  SharepointPage,
  SharepointPageContent,
  SharepointReadPageResponse,
  SharepointToolParams,
} from '@/tools/sharepoint/types'
import {
  assertGraphNextPageUrlForCollection,
  cleanODataMetadata,
  escapeODataString,
  extractTextFromCanvasLayout,
  getGraphNextPageUrl,
  graphPathSegment,
  optionalTrim,
} from '@/tools/sharepoint/utils'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const logger = createLogger('SharePointReadPage')

const PAGE_SELECT =
  'id,name,title,webUrl,pageLayout,description,createdDateTime,lastModifiedDateTime,publishingState,createdBy,lastModifiedBy'

const PAGE_AUDIT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  publishingState: {
    type: 'object',
    description: 'Publishing state (level such as draft, checkout, or published; versionId)',
    optional: true,
  },
  createdBy: {
    type: 'object',
    description: 'Identity set of the creator (e.g. user.displayName, user.email)',
    optional: true,
  },
  lastModifiedBy: {
    type: 'object',
    description: 'Identity set of the last modifier (e.g. user.displayName, user.email)',
    optional: true,
  },
}

function toPage(page: GraphApiPageFields): SharepointPage {
  return {
    id: page.id,
    name: page.name,
    title: page.title || page.name,
    webUrl: page.webUrl,
    pageLayout: page.pageLayout,
    description: page.description ?? null,
    createdDateTime: page.createdDateTime,
    lastModifiedDateTime: page.lastModifiedDateTime,
    publishingState: page.publishingState ?? null,
    createdBy: page.createdBy ?? null,
    lastModifiedBy: page.lastModifiedBy ?? null,
  }
}

export const readPageTool: ToolConfig<SharepointToolParams, SharepointReadPageResponse> = {
  id: 'sharepoint_read_page',
  name: 'Read SharePoint Page',
  description: 'Read a specific page from a SharePoint site',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the page to read. Example: a GUID like 12345678-1234-1234-1234-123456789012',
    },
    pageName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the page to read (alternative to pageId). Example: Home.aspx or About-Us.aspx',
    },
    maxPages: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description:
        'Maximum number of pages to return when listing all pages (default: 10, max: 50)',
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
        return assertGraphNextPageUrlForCollection(params.nextPageUrl, [
          'microsoft.graph.sitePage',
          'pages',
        ])
      }

      const siteId = optionalTrim(params.siteId) || optionalTrim(params.siteSelector) || 'root'
      const pageId = optionalTrim(params.pageId)
      const encodedSiteId = graphPathSegment(siteId, 'siteId')

      let baseUrl: string
      if (pageId) {
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/pages/${graphPathSegment(pageId, 'pageId')}/microsoft.graph.sitePage`
      } else {
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/pages/microsoft.graph.sitePage`
      }

      const url = new URL(baseUrl)

      url.searchParams.append('$select', PAGE_SELECT)

      if (params.pageName && !pageId) {
        const pageName = params.pageName.trim()
        const pageNameWithAspx = pageName.endsWith('.aspx') ? pageName : `${pageName}.aspx`
        const escapedPageName = escapeODataString(pageName)
        const escapedPageNameWithAspx = escapeODataString(pageNameWithAspx)

        url.searchParams.append(
          '$filter',
          `name eq '${escapedPageName}' or name eq '${escapedPageNameWithAspx}'`
        )
        url.searchParams.append('$top', '10')
      } else if (!pageId && !params.pageName) {
        const requestedMaxPages =
          typeof params.maxPages === 'number' ? params.maxPages : Number(params.maxPages || 10)
        const maxPages = Math.min(Number.isFinite(requestedMaxPages) ? requestedMaxPages : 10, 50)
        url.searchParams.append('$top', maxPages.toString())
      }

      if (pageId) {
        url.searchParams.append('$expand', 'canvasLayout')
      }

      const finalUrl = url.toString()

      logger.info('SharePoint API URL', {
        finalUrl,
        siteId,
        pageId,
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

    logger.info('SharePoint API response', {
      pageId: params?.pageId,
      pageName: params?.pageName,
      resultsCount: data.value?.length || (data.id ? 1 : 0),
      hasDirectPage: !!data.id,
      hasSearchResults: !!data.value,
    })

    if (params?.pageId) {
      const pageData = data
      const contentData = {
        content: extractTextFromCanvasLayout(data.canvasLayout),
        canvasLayout: data.canvasLayout ?? null,
      }

      return {
        success: true,
        output: {
          page: toPage(pageData),
          content: contentData,
        },
      }
    }

    if (!data.value || data.value.length === 0) {
      logger.info('No pages found', {
        searchName: params?.pageName,
        siteId: optionalTrim(params?.siteId) || optionalTrim(params?.siteSelector) || 'root',
        totalResults: data.value?.length || 0,
      })
      const message = params?.pageName
        ? `Page with name '${params?.pageName}' not found. Make sure the page exists and you have access to it. Note: SharePoint page names typically include the .aspx extension.`
        : 'No pages found on this SharePoint site.'
      return {
        success: true,
        output: {
          content: {
            content: message,
            canvasLayout: null,
          },
        },
      }
    }

    logger.info('Found pages', {
      searchName: params?.pageName,
      foundPages: data.value.map((p) => ({ id: p.id, name: p.name, title: p.title })),
      totalCount: data.value.length,
    })

    if (params?.pageName) {
      const pageData = data.value[0]
      const siteId = optionalTrim(params?.siteId) || optionalTrim(params?.siteSelector) || 'root'
      const contentUrl = `https://graph.microsoft.com/v1.0/sites/${graphPathSegment(siteId, 'siteId')}/pages/${graphPathSegment(pageData.id, 'pageId')}/microsoft.graph.sitePage?$expand=canvasLayout`

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
          page: toPage(pageData),
          content: contentData,
        },
      }
    }

    const siteId = optionalTrim(params?.siteId) || optionalTrim(params?.siteSelector) || 'root'
    const pagesWithContent = []
    const nextPageUrl = getGraphNextPageUrl(data)

    logger.info('Fetching content for all pages', {
      totalPages: data.value.length,
      siteId,
    })

    const encodedSiteId = graphPathSegment(siteId, 'siteId')
    for (const pageInfo of data.value) {
      const contentUrl = `https://graph.microsoft.com/v1.0/sites/${encodedSiteId}/pages/${graphPathSegment(pageInfo.id, 'pageId')}/microsoft.graph.sitePage?$expand=canvasLayout`

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
          page: toPage(pageInfo),
          content: contentData,
        })
      } catch (error) {
        logger.error('Error fetching content for page', {
          pageId: pageInfo.id,
          pageName: pageInfo.name,
          error: toError(error).message,
        })

        pagesWithContent.push({
          page: toPage(pageInfo),
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
        nextPageUrl,
      },
    }
  },

  outputs: {
    page: {
      type: 'object',
      description: 'Information about the SharePoint page',
      properties: {
        id: { type: 'string', description: 'The unique ID of the page' },
        name: { type: 'string', description: 'The name of the page' },
        title: { type: 'string', description: 'The title of the page' },
        webUrl: { type: 'string', description: 'The URL to access the page' },
        pageLayout: { type: 'string', description: 'The layout type of the page' },
        description: { type: 'string', description: 'The description of the page', optional: true },
        createdDateTime: { type: 'string', description: 'When the page was created' },
        lastModifiedDateTime: { type: 'string', description: 'When the page was last modified' },
        ...PAGE_AUDIT_OUTPUT_PROPERTIES,
      },
    },
    pages: {
      type: 'array',
      description: 'List of SharePoint pages',
      items: {
        type: 'object',
        properties: {
          page: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The unique ID of the page' },
              name: { type: 'string', description: 'The name of the page' },
              title: { type: 'string', description: 'The title of the page' },
              webUrl: { type: 'string', description: 'The URL to access the page' },
              pageLayout: { type: 'string', description: 'The layout type of the page' },
              description: {
                type: 'string',
                description: 'The description of the page',
                optional: true,
              },
              createdDateTime: { type: 'string', description: 'When the page was created' },
              lastModifiedDateTime: {
                type: 'string',
                description: 'When the page was last modified',
              },
              ...PAGE_AUDIT_OUTPUT_PROPERTIES,
            },
          },
          content: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Extracted text content from the page' },
              canvasLayout: {
                type: 'object',
                description: 'Raw SharePoint canvas layout structure',
              },
            },
          },
        },
      },
    },
    content: {
      type: 'object',
      description: 'Content of the SharePoint page',
      properties: {
        content: { type: 'string', description: 'Extracted text content from the page' },
        canvasLayout: { type: 'object', description: 'Raw SharePoint canvas layout structure' },
      },
    },
    totalPages: { type: 'number', description: 'Total number of pages found' },
    nextPageUrl: {
      type: 'string',
      description: 'Full Microsoft Graph @odata.nextLink URL for the next page of results',
      optional: true,
    },
  },
}
