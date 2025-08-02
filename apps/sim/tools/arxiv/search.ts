import type { ArxivSearchParams, ArxivSearchResponse } from '@/tools/arxiv/types'
import { extractTotalResults, parseArxivXML } from '@/tools/arxiv/utils'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<ArxivSearchParams, ArxivSearchResponse> = {
  id: 'arxiv_search',
  name: 'ArXiv Search',
  description: 'Search for academic papers on ArXiv by keywords, authors, titles, or other fields.',
  version: '1.0.0',

  params: {
    searchQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    searchField: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Field to search in: all, ti (title), au (author), abs (abstract), co (comment), jr (journal), cat (category), rn (report number)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10, max: 2000)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort by: relevance, lastUpdatedDate, submittedDate (default: relevance)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort order: ascending, descending (default: descending)',
    },
  },

  request: {
    url: (params: ArxivSearchParams) => {
      const baseUrl = 'http://export.arxiv.org/api/query'
      const searchParams = new URLSearchParams()

      // Build search query
      let searchQuery = params.searchQuery
      if (params.searchField && params.searchField !== 'all') {
        searchQuery = `${params.searchField}:${params.searchQuery}`
      }
      searchParams.append('search_query', searchQuery)

      // Add optional parameters
      if (params.maxResults) {
        searchParams.append('max_results', Math.min(params.maxResults, 2000).toString())
      } else {
        searchParams.append('max_results', '10')
      }

      if (params.sortBy) {
        searchParams.append('sortBy', params.sortBy)
      }

      if (params.sortOrder) {
        searchParams.append('sortOrder', params.sortOrder)
      }

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/xml',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(`ArXiv API error: ${response.status} ${response.statusText}`)
    }

    const xmlText = await response.text()

    // Parse XML response
    const papers = parseArxivXML(xmlText)
    const totalResults = extractTotalResults(xmlText)

    return {
      success: true,
      output: {
        papers,
        totalResults,
        query: '', // Will be filled by the calling code
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while searching ArXiv'
  },
}
