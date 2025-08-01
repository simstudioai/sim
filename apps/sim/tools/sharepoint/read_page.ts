import type { SharepointReadPageResponse, SharepointToolParams } from '@/tools/sharepoint/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SharePointReadPage')

// Extract readable text from SharePoint canvas layout
function extractTextFromCanvasLayout(canvasLayout: any): string {
  logger.info('Extracting text from canvas layout', {
    hasCanvasLayout: !!canvasLayout,
    hasHorizontalSections: !!canvasLayout?.horizontalSections,
    sectionsCount: canvasLayout?.horizontalSections?.length || 0
  })
  
  if (!canvasLayout?.horizontalSections) {
    logger.info('No canvas layout or horizontal sections found')
    return ''
  }
  
  const textParts: string[] = []
  
  for (const section of canvasLayout.horizontalSections) {
    logger.info('Processing section', {
      sectionId: section.id,
      hasColumns: !!section.columns,
      hasWebparts: !!section.webparts,
      columnsCount: section.columns?.length || 0
    })
    
    if (section.columns) {
      for (const column of section.columns) {
        if (column.webparts) {
          for (const webpart of column.webparts) {
            logger.info('Processing webpart', {
              webpartId: webpart.id,
              hasInnerHtml: !!webpart.innerHtml,
              innerHtml: webpart.innerHtml
            })
            
            if (webpart.innerHtml) {
              // Extract text from HTML, removing tags
              const text = webpart.innerHtml.replace(/<[^>]*>/g, '').trim()
              if (text) {
                textParts.push(text)
                logger.info('Extracted text', { text })
              }
            }
          }
        }
      }
    } else if (section.webparts) {
      for (const webpart of section.webparts) {
        if (webpart.innerHtml) {
          const text = webpart.innerHtml.replace(/<[^>]*>/g, '').trim()
          if (text) textParts.push(text)
        }
      }
    }
  }
  
  const finalContent = textParts.join('\n\n')
  logger.info('Final extracted content', {
    textPartsCount: textParts.length,
    finalContentLength: finalContent.length,
    finalContent
  })
  
  return finalContent
}

// Remove OData metadata from objects
function cleanODataMetadata(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  if (Array.isArray(obj)) {
    return obj.map(item => cleanODataMetadata(item))
  }
  
  const cleaned: any = {}
  for (const [key, value] of Object.entries(obj)) {
    // Skip OData metadata keys
    if (key.includes('@odata')) continue
    
    cleaned[key] = cleanODataMetadata(value)
  }
  
  return cleaned
}

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
      // Validate that at least pageId or pageName is provided
      if (!params.pageId && !params.pageName) {
        throw new Error('Either pageId or pageName must be provided')
      }

      // Use specific site if provided, otherwise use root site
      const siteId = params.siteId || params.siteSelector || 'root'
      
      let baseUrl: string
      if (params.pageId) {
        // Read specific page by ID
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${params.pageId}`
      } else if (params.pageName) {
        // Search for page by name - list all pages and filter
        baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages`
      } else {
        throw new Error('Either pageId or pageName must be provided')
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
        searchParams: Object.fromEntries(url.searchParams)
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
    const data = await response.json()

    if (!response.ok) {
      logger.error('SharePoint API error', {
        status: response.status,
        statusText: response.statusText,
        error: data.error,
        data
      })
      throw new Error(data.error?.message || 'Failed to read SharePoint page')
    }

    logger.info('SharePoint API response', {
      pageId: params?.pageId,
      pageName: params?.pageName,
      resultsCount: data.value?.length || (data.id ? 1 : 0),
      hasDirectPage: !!data.id,
      hasSearchResults: !!data.value
    })

    let pageData: any
    let contentData: any = { content: '' }

    if (params?.pageId) {
      // Direct page access
      pageData = data
      contentData = {
        content: extractTextFromCanvasLayout(data.canvasLayout),
        canvasLayout: data.canvasLayout,
      }
    } else {
      // Search result - take first match
      if (!data.value || data.value.length === 0) {
        logger.error('No pages found', {
          searchName: params?.pageName,
          siteId: params?.siteId || params?.siteSelector || 'root',
          totalResults: data.value?.length || 0
        })
        throw new Error(`Page with name '${params?.pageName}' not found. Make sure the page exists and you have access to it. Note: SharePoint page names typically include the .aspx extension.`)
      }
      
      logger.info('Found pages', {
        searchName: params?.pageName,
        foundPages: data.value.map((p: any) => ({ id: p.id, name: p.name, title: p.title })),
        selectedPage: data.value[0].name
      })
      
      pageData = data.value[0]
      
      // For search results, we need to make another call to get the content
      if (pageData.id) {
        const siteId = params?.siteId || params?.siteSelector || 'root'
        const contentUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages/${pageData.id}/microsoft.graph.sitePage?$expand=canvasLayout`
        
        logger.info('Making second API call to get page content', {
          pageId: pageData.id,
          contentUrl,
          siteId
        })
        
        const contentResponse = await fetch(contentUrl, {
          headers: {
            Authorization: `Bearer ${params?.accessToken}`,
            Accept: 'application/json',
          },
        })
        
        logger.info('Content API response', {
          status: contentResponse.status,
          statusText: contentResponse.statusText,
          ok: contentResponse.ok
        })
        
        if (contentResponse.ok) {
          const contentResult = await contentResponse.json()
          logger.info('Content API result', {
            hasCanvasLayout: !!contentResult.canvasLayout,
            contentResultKeys: Object.keys(contentResult)
          })
          
          contentData = {
            content: extractTextFromCanvasLayout(contentResult.canvasLayout),
            canvasLayout: cleanODataMetadata(contentResult.canvasLayout),
          }
        } else {
          const errorText = await contentResponse.text()
          logger.error('Failed to fetch page content', {
            status: contentResponse.status,
            statusText: contentResponse.statusText,
            error: errorText
          })
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
          createdDateTime: pageData.createdDateTime,
          lastModifiedDateTime: pageData.lastModifiedDateTime,
        },
        content: contentData,
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while reading the SharePoint page'
  },
}
