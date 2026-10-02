import type {
  LinkupFetchApiResponse,
  LinkupFetchParams,
  LinkupFetchRequestBody,
  LinkupFetchToolResponse,
} from '@/tools/linkup/types'
import { isEnabled } from '@/tools/linkup/utils'
import type { ToolConfig } from '@/tools/types'

export const fetchTool: ToolConfig<LinkupFetchParams, LinkupFetchToolResponse> = {
  id: 'linkup_fetch',
  name: 'Linkup Fetch',
  description:
    'Fetch a single webpage using Linkup and return its content as clean markdown, with optional raw HTML and extracted images.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL of the webpage to fetch (e.g., "https://docs.linkup.so")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enter your Linkup API key',
    },
    renderJs: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Render the JavaScript of the webpage before extracting its content',
    },
    includeRawHtml: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the raw HTML of the webpage in the response',
    },
    extractImages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Extract the images from the webpage',
    },
  },

  hosting: {
    envKeyPrefix: 'LINKUP_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'linkup',
    pricing: {
      type: 'custom',
      getCost: (params) => {
        // Linkup pricing (https://docs.linkup.so/pages/documentation/platform/pricing):
        //   Standard:            $0.001/call
        //   Standard + renderJs: $0.005/call
        const renderJs = isEnabled(params.renderJs)
        const cost = renderJs ? 0.005 : 0.001
        return { cost, metadata: { renderJs } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  request: {
    url: 'https://api.linkup.so/v1/fetch',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: LinkupFetchRequestBody = {
        url: params.url?.trim() ?? '',
        renderJs: isEnabled(params.renderJs),
      }

      if (params.includeRawHtml !== undefined) {
        body.includeRawHtml = isEnabled(params.includeRawHtml)
      }
      if (params.extractImages !== undefined) {
        body.extractImages = isEnabled(params.extractImages)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: LinkupFetchApiResponse = await response.json()

    return {
      success: true,
      output: {
        markdown: data.markdown ?? '',
        rawHtml: data.rawHtml ?? null,
        images: data.images ?? [],
        favicon: data.favicon ?? null,
      },
    }
  },

  outputs: {
    markdown: {
      type: 'string',
      description: 'The clean markdown content of the webpage',
    },
    rawHtml: {
      type: 'string',
      description: 'The raw HTML of the webpage, when includeRawHtml is enabled',
      nullable: true,
    },
    images: {
      type: 'array',
      description: 'Images extracted from the webpage, when extractImages is enabled',
      items: {
        type: 'object',
        properties: {
          alt: { type: 'string', description: 'The alt text of the image' },
          url: { type: 'string', description: 'The URL of the image' },
        },
      },
    },
    favicon: {
      type: 'string',
      description: 'The URL of the website favicon',
      nullable: true,
    },
  },
}
