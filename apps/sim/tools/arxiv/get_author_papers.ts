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
        (params.maxResults ? Math.min(Number(params.maxResults), 2000) : 10).toString()
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

  transformResponse: async (response: Response, params) => {
    const xmlText = await response.text()

    const papers = parseArxivXML(xmlText)
    const totalResults = extractTotalResults(xmlText)

    return {
      success: true,
      output: {
        authorPapers: papers,
        totalResults,
        authorName: params?.authorName ?? '',
      },
    }
  },

  outputs: {
    authorPapers: {
      type: 'array',
      description: 'Array of papers authored by the specified author',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          authors: { type: 'array', items: { type: 'string' } },
          published: { type: 'string' },
          updated: { type: 'string' },
          link: { type: 'string' },
          pdfLink: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          primaryCategory: { type: 'string' },
          comment: { type: 'string', optional: true },
          journalRef: { type: 'string', optional: true },
          doi: { type: 'string', optional: true },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of papers found for the author',
    },
    authorName: { type: 'string', description: 'The author name that was searched' },
  },
}
