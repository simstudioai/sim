import type { ToolConfig } from '@/tools/types'
import type {
  WikipediaPageSummaryParams,
  WikipediaPageSummaryResponse,
} from '@/tools/wikipedia/types'
import { WIKIPEDIA_PAGE_SUMMARY_OUTPUT_PROPERTIES } from '@/tools/wikipedia/types'

export const pageSummaryTool: ToolConfig<WikipediaPageSummaryParams, WikipediaPageSummaryResponse> =
  {
    id: 'wikipedia_summary',
    name: 'Wikipedia Page Summary',
    description: 'Get a summary and metadata for a specific Wikipedia page.',
    version: '1.0.0',

    params: {
      pageTitle: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Title of the Wikipedia page to get summary for',
      },
    },

    request: {
      url: (params: WikipediaPageSummaryParams) => {
        const encodedTitle = encodeURIComponent(params.pageTitle.replace(/ /g, '_'))
        return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`
      },
      method: 'GET',
      headers: () => ({
        'User-Agent': 'Sim/1.0 (https://sim.ai)',
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      return {
        success: true,
        output: {
          summary: {
            type: data.type || '',
            title: data.title || '',
            displaytitle: data.displaytitle || data.title || '',
            description: data.description,
            extract: data.extract || '',
            extract_html: data.extract_html,
            thumbnail: data.thumbnail,
            originalimage: data.originalimage,
            content_urls: data.content_urls || {
              desktop: { page: '', revisions: '', edit: '', talk: '' },
              mobile: { page: '', revisions: '', edit: '', talk: '' },
            },
            lang: data.lang || '',
            dir: data.dir || 'ltr',
            timestamp: data.timestamp || '',
            pageid: data.pageid || 0,
            wikibase_item: data.wikibase_item,
            coordinates: data.coordinates,
          },
        },
      }
    },

    outputs: {
      summary: {
        type: 'object',
        description: 'Wikipedia page summary and metadata',
        properties: WIKIPEDIA_PAGE_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
  }
