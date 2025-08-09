import type { ToolConfig } from '@/tools/types'
import type { WikipediaRandomPageResponse } from '@/tools/wikipedia/types'

export const randomPageTool: ToolConfig<Record<string, never>, WikipediaRandomPageResponse> = {
  id: 'wikipedia_random',
  name: 'Wikipedia Random Page',
  description: 'Get a random Wikipedia page.',
  version: '1.0.0',

  params: {},

  outputs: {
    randomPage: {
      type: 'object',
      description: 'Random Wikipedia page data',
      properties: {
        title: { type: 'string', description: 'Page title' },
        extract: { type: 'string', description: 'Page extract/summary' },
        description: { type: 'string', description: 'Page description', optional: true },
        thumbnail: { type: 'object', description: 'Thumbnail image data', optional: true },
        content_urls: { type: 'object', description: 'URLs to access the page' },
      },
    },
  },

  request: {
    url: () => {
      return 'https://en.wikipedia.org/api/rest_v1/page/random/summary'
    },
    method: 'GET',
    headers: () => ({
      'User-Agent': 'SimStudio/1.0 (https://sim.ai)',
      Accept: 'application/json',
    }),
    isInternalRoute: false,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(`Wikipedia random page API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        randomPage: {
          type: data.type || '',
          title: data.title || '',
          displaytitle: data.displaytitle || data.title || '',
          description: data.description,
          extract: data.extract || '',
          thumbnail: data.thumbnail,
          content_urls: data.content_urls || { desktop: { page: '' }, mobile: { page: '' } },
          lang: data.lang || '',
          timestamp: data.timestamp || '',
          pageid: data.pageid || 0,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while retrieving a random Wikipedia page'
  },
}
