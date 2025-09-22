import type { ArxivGetAuthorPapersParams, ArxivGetAuthorPapersResponse } from '@/tools/arxiv/types'
import { extractTotalResults, parseArxivXML } from '@/tools/arxiv/utils'
import type { ToolConfig } from '@/tools/types'

export const getAuthorPapersTool: ToolConfig<
  ArxivGetAuthorPapersParams,
  ArxivGetAuthorPapersResponse
> = {
  id: 'arxiv_get_author_papers',
  name: 'ArXiv Get Author Papers',
  description: 'Search for papers by a specific author on ArXiv.',
  version: '1.0.0',

  params: {
    authorName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Author name to search for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10, max: 2000)',
    },
  },

  request: {
    url: (params: ArxivGetAuthorPapersParams) => {
      const baseUrl = 'https://export.arxiv.org/api/query'
      const searchParams = new URLSearchParams()

      searchParams.append('search_query', `au:"${params.authorName}"`)
      searchParams.append(
        'max_results',
        (params.maxResults ? Math.min(params.maxResults, 2000) : 10).toString()
      )
      searchParams.append('sortBy', 'submittedDate')
      searchParams.append('sortOrder', 'descending')

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/xml',
    }),
  },

  transformResponse: async (response: Response) => {
    const xmlText = await response.text()

    // Parse XML response
    const papers = parseArxivXML(xmlText)
    const totalResults = extractTotalResults(xmlText)

    return {
      success: true,
      output: {
        authorPapers: papers,
        totalResults,
        authorName: '', // Will be filled by the calling code
      },
    }
  },

  outputs: {
    authorPapers: {
      type: 'json',
      description: 'Array of papers authored by the specified author',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          authors: { type: 'string' },
          published: { type: 'string' },
          updated: { type: 'string' },
          link: { type: 'string' },
          pdfLink: { type: 'string' },
          categories: { type: 'string' },
          primaryCategory: { type: 'string' },
          comment: { type: 'string' },
          journalRef: { type: 'string' },
          doi: { type: 'string' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of papers found for the author',
    },
  },
}
