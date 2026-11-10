import type { PiloterrFetchHtmlParams, PiloterrFetchHtmlResponse } from '@/tools/piloterr/types'
import type { ToolConfig } from '@/tools/types'

export const piloterrFetchHtmlTool: ToolConfig<PiloterrFetchHtmlParams, PiloterrFetchHtmlResponse> =
  {
    id: 'piloterr_fetch_html',
    name: 'Piloterr Fetch HTML',
    description:
      'Fetch a public web page over fast HTTP, without running JavaScript, and get its HTML.',
    version: '1.0.0',

    params: {
      url: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'URL of the page (e.g., "https://example.com")',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Piloterr API key',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(`https://api.piloterr.com/v2/website/crawler`)
        url.searchParams.set('query', params.url.trim())
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        'x-api-key': params.apiKey,
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const body: unknown = await response.json()
      return {
        success: true,
        output: {
          html: typeof body === 'string' ? body : '',
        },
      }
    },

    outputs: {
      html: {
        type: 'string',
        description: 'HTML of the page',
      },
    },
  }
