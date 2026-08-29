import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import {
  applyFirecrawlScrapeOptionsModelInput,
  selectFirecrawlScrapeOptionsModelInput,
} from '@/tools/firecrawl/model-input'
import type { SearchData, SearchParams, SearchResponse } from '@/tools/firecrawl/types'
import { SEARCH_DATA_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'firecrawl_search',
  name: 'Firecrawl Search',
  description: 'Search for information on the web using Firecrawl',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to use',
    },
    sources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which result sets to search: any of "web", "news", "images". Determines which arrays appear on the output. Defaults to ["web"].',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per source',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scrape options supplied by existing configurations',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  hosting: firecrawlHosting(),

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        scrapeOptions: selectFirecrawlScrapeOptionsModelInput(params.scrapeOptions),
      }),
      applyProjected: (selectedParams, projectedSelection) => ({
        scrapeOptions: applyFirecrawlScrapeOptionsModelInput(
          selectedParams.scrapeOptions,
          projectedSelection.scrapeOptions
        ),
      }),
    },
    method: 'POST',
    url: 'https://api.firecrawl.dev/v2/search',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add optional parameters if provided (truthy check filters empty strings, null, undefined)
      if (params.limit) body.limit = Number(params.limit)
      if (params.sources) body.sources = params.sources
      if (params.categories) body.categories = params.categories
      if (params.tbs) body.tbs = params.tbs
      if (params.location) body.location = params.location
      if (params.country) body.country = params.country
      if (params.timeout) body.timeout = Number(params.timeout)
      if (typeof params.ignoreInvalidURLs === 'boolean')
        body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    /**
     * `data` is the source-keyed envelope, so an absent body must still resolve to an object —
     * downstream references read `data.web` / `data.news` / `data.images`.
     */
    const searchData: SearchData =
      data.data && typeof data.data === 'object' && !Array.isArray(data.data)
        ? (data.data as SearchData)
        : {}

    return {
      success: true,
      output: {
        data: searchData,
        creditsUsed: data.creditsUsed,
      },
    }
  },

  outputs: {
    data: {
      type: 'object',
      description:
        'Search results keyed by source (web, news, images), each with optional scraped content and metadata',
      properties: SEARCH_DATA_OUTPUT_PROPERTIES,
    },
  },
}
