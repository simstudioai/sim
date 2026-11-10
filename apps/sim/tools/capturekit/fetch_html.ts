import type {
  CaptureKitFetchHtmlParams,
  CaptureKitFetchHtmlResponse,
} from '@/tools/capturekit/types'
import type { ToolConfig } from '@/tools/types'

export const capturekitFetchHtmlTool: ToolConfig<
  CaptureKitFetchHtmlParams,
  CaptureKitFetchHtmlResponse
> = {
  id: 'capturekit_fetch_html',
  name: 'CaptureKit Fetch HTML',
  description: 'Fetch the raw HTML of a public page over plain HTTP, without a browser.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page, with http or https (e.g., "https://example.com")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CaptureKit API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.capturekit.dev/v1/website/crawler`)
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
      description: 'Raw HTML of the page',
    },
  },
}
