import type { PiloterrRenderHtmlParams, PiloterrRenderHtmlResponse } from '@/tools/piloterr/types'
import type { ToolConfig } from '@/tools/types'

export const piloterrRenderHtmlTool: ToolConfig<
  PiloterrRenderHtmlParams,
  PiloterrRenderHtmlResponse
> = {
  id: 'piloterr_render_html',
  name: 'Piloterr Render HTML',
  description:
    'Render a JavaScript-heavy page in a headless browser and get the HTML after rendering.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page (e.g., "https://example.com")',
    },
    waitInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds to wait after the page loads before reading the HTML (defaults to 0)',
    },
    blockAds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Block ad requests while rendering',
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
      const url = new URL(`https://api.piloterr.com/v2/website/rendering`)
      url.searchParams.set('query', params.url.trim())
      if (params.waitInSeconds != null)
        url.searchParams.set('wait_in_seconds', String(params.waitInSeconds))
      if (params.blockAds != null) url.searchParams.set('block_ads', String(params.blockAds))
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
      description: 'HTML of the page after rendering',
    },
  },
}
