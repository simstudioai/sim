import type { ToolConfig } from '@/tools/types'
import type {
  WikipediaPageContentParams,
  WikipediaPageContentResponse,
} from '@/tools/wikipedia/types'
import { WIKIPEDIA_PAGE_CONTENT_OUTPUT_PROPERTIES } from '@/tools/wikipedia/types'

export const pageContentTool: ToolConfig<WikipediaPageContentParams, WikipediaPageContentResponse> =
  {
    id: 'wikipedia_content',
    name: 'Wikipedia Page Content',
    description: 'Get the full HTML content of a Wikipedia page.',
    version: '1.0.0',

    params: {
      pageTitle: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Title of the Wikipedia page to get content for',
      },
    },

    request: {
      url: (params: WikipediaPageContentParams) => {
        const encodedTitle = encodeURIComponent(params.pageTitle.replace(/ /g, '_'))
        return `https://en.wikipedia.org/api/rest_v1/page/html/${encodedTitle}`
      },
      method: 'GET',
      headers: () => ({
        'User-Agent': 'Sim/1.0 (https://sim.ai)',
        Accept:
          'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.1.0"',
      }),
    },

    transformResponse: async (response: Response, params) => {
      const html = await response.text()

      const etag = response.headers.get('etag') ?? ''
      const revision =
        response.headers.get('content-revision-id') ?? etag.match(/^(?:W\/)?"(\d+)/)?.[1] ?? '0'
      const timestamp = response.headers.get('last-modified') || new Date().toISOString()

      return {
        success: true,
        output: {
          content: {
            title: params?.pageTitle?.trim() ?? '',
            pageid: 0,
            html: html,
            revision: Number.parseInt(revision, 10),
            tid: etag,
            timestamp: timestamp,
            content_model: 'wikitext',
            content_format: 'text/html',
          },
        },
      }
    },

    outputs: {
      content: {
        type: 'object',
        description: 'Full HTML content and metadata of the Wikipedia page',
        properties: WIKIPEDIA_PAGE_CONTENT_OUTPUT_PROPERTIES,
      },
    },
  }
