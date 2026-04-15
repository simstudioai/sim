import type {
  BrightDataSerpSearchParams,
  BrightDataSerpSearchResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

const SEARCH_ENGINE_CONFIG: Record<
  string,
  { url: string; queryKey: string; numKey: string; langKey: string; countryKey: string }
> = {
  google: {
    url: 'https://www.google.com/search',
    queryKey: 'q',
    numKey: 'num',
    langKey: 'hl',
    countryKey: 'gl',
  },
  bing: {
    url: 'https://www.bing.com/search',
    queryKey: 'q',
    numKey: 'count',
    langKey: 'setLang',
    countryKey: 'cc',
  },
  duckduckgo: {
    url: 'https://duckduckgo.com/',
    queryKey: 'q',
    numKey: '',
    langKey: '',
    countryKey: '',
  },
  yandex: {
    url: 'https://yandex.com/search/',
    queryKey: 'text',
    numKey: 'numdoc',
    langKey: 'lang',
    countryKey: '',
  },
} as const

export const brightDataSerpSearchTool: ToolConfig<
  BrightDataSerpSearchParams,
  BrightDataSerpSearchResponse
> = {
  id: 'brightdata_serp_search',
  name: 'Bright Data SERP Search',
  description:
    'Search Google, Bing, DuckDuckGo, or Yandex and get structured search results using Bright Data SERP API.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    zone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SERP API zone name from your Bright Data dashboard (e.g., "serp_api1")',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "best project management tools")',
    },
    searchEngine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search engine to use: "google", "bing", "duckduckgo", or "yandex". Defaults to "google"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code for localized results (e.g., "us", "gb")',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter language code (e.g., "en", "es")',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 20). Defaults to 10',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.brightdata.com/request',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const engine = params.searchEngine || 'google'
      const config = SEARCH_ENGINE_CONFIG[engine] || SEARCH_ENGINE_CONFIG.google

      const searchParams = new URLSearchParams()
      searchParams.set(config.queryKey, params.query)
      if (params.numResults && config.numKey) {
        searchParams.set(config.numKey, String(params.numResults))
      }
      if (params.language && config.langKey) {
        searchParams.set(config.langKey, params.language)
      }
      if (params.country && config.countryKey) {
        searchParams.set(config.countryKey, params.country)
      }

      searchParams.set('brd_json', '1')

      const body: Record<string, unknown> = {
        zone: params.zone,
        url: `${config.url}?${searchParams.toString()}`,
        format: 'raw',
      }
      if (params.country) body.country = params.country
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `SERP request failed with status ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    let results: Array<{
      title: string | null
      url: string | null
      description: string | null
      rank: number | null
    }> = []
    let data: Record<string, unknown> | null = null

    if (contentType.includes('application/json')) {
      data = await response.json()

      if (Array.isArray(data?.organic)) {
        results = data.organic.map((item: Record<string, unknown>, index: number) => ({
          title: (item.title as string) ?? null,
          url: (item.link as string) ?? (item.url as string) ?? null,
          description: (item.description as string) ?? (item.snippet as string) ?? null,
          rank: index + 1,
        }))
      } else if (Array.isArray(data)) {
        results = data.map((item: Record<string, unknown>, index: number) => ({
          title: (item.title as string) ?? null,
          url: (item.link as string) ?? (item.url as string) ?? null,
          description: (item.description as string) ?? (item.snippet as string) ?? null,
          rank: index + 1,
        }))
      }
    } else {
      const text = await response.text()
      results = [
        {
          title: 'Raw SERP Response',
          url: null,
          description: text.slice(0, 500),
          rank: 1,
        },
      ]
    }

    return {
      success: true,
      output: {
        results,
        query:
          ((data?.general as Record<string, unknown> | undefined)?.query as string) ??
          params?.query ??
          null,
        searchEngine:
          ((data?.general as Record<string, unknown> | undefined)?.search_engine as string) ??
          params?.searchEngine ??
          null,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of search results',
      items: {
        type: 'object',
        description: 'A search result entry',
        properties: {
          title: { type: 'string', description: 'Title of the search result', optional: true },
          url: { type: 'string', description: 'URL of the search result', optional: true },
          description: {
            type: 'string',
            description: 'Snippet or description of the result',
            optional: true,
          },
          rank: { type: 'number', description: 'Position in search results', optional: true },
        },
      },
    },
    query: { type: 'string', description: 'The search query that was executed', optional: true },
    searchEngine: {
      type: 'string',
      description: 'The search engine that was used',
      optional: true,
    },
  },
}
