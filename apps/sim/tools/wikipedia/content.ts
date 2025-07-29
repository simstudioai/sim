import type { ToolConfig } from '@/tools/types'
import type {
  WikipediaPageContentParams,
  WikipediaPageContentResponse,
} from '@/tools/wikipedia/types'

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
        'User-Agent': 'SimStudio/1.0 (https://simstudio.ai)',
        Accept:
          'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.1.0"',
      }),
      isInternalRoute: false,
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Wikipedia page not found')
        }
        throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`)
      }

      const html = await response.text()

      // Extract metadata from response headers
      const revision = response.headers.get('etag')?.match(/^"(\d+)/)?.[1] || '0'
      const timestamp = response.headers.get('last-modified') || new Date().toISOString()

      return {
        success: true,
        output: {
          content: {
            title: '', // Will be filled by the calling code
            pageid: 0, // Not available from this endpoint
            html: html,
            revision: Number.parseInt(revision, 10),
            tid: response.headers.get('etag') || '',
            timestamp: timestamp,
            content_model: 'wikitext',
            content_format: 'text/html',
          },
        },
      }
    },

    transformError: (error) => {
      return error instanceof Error
        ? error.message
        : 'An error occurred while retrieving the Wikipedia page content'
    },
  }
