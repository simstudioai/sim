import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevScrapeImagesParams,
  ContextDevScrapeImagesResponse,
} from '@/tools/context_dev/types'
import { IMAGE_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevScrapeImagesTool: ToolConfig<
  ContextDevScrapeImagesParams,
  ContextDevScrapeImagesResponse
> = {
  id: 'context_dev_scrape_images',
  name: 'Context.dev Scrape Images',
  description: 'Discover every image asset on a page, with optional dimension and type enrichment.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevScrapeImagesParams>(),

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The full URL to scrape images from (must include http:// or https://)',
    },
    maxAgeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cache duration in milliseconds (0-2592000000, default: 86400000)',
    },
    waitForMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Browser wait time after page load in milliseconds (0-30000)',
    },
    timeoutMS: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request timeout in milliseconds (1000-300000)',
    },
    enrichResolution: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Measure image dimensions (enables 5-credit enrichment)',
    },
    enrichHostedUrl: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Host images on a CDN and return their URL and MIME type (enables enrichment)',
    },
    enrichClassification: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Classify each image by visual asset type (enables enrichment)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Context.dev API key',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/scrape/images`)
      appendParam(url.searchParams, 'url', params.url)
      appendParam(url.searchParams, 'maxAgeMs', params.maxAgeMs)
      appendParam(url.searchParams, 'waitForMs', params.waitForMs)
      appendParam(url.searchParams, 'timeoutMS', params.timeoutMS)
      appendParam(url.searchParams, 'enrichment[resolution]', params.enrichResolution)
      appendParam(url.searchParams, 'enrichment[hostedUrl]', params.enrichHostedUrl)
      appendParam(url.searchParams, 'enrichment[classification]', params.enrichClassification)
      return url.toString()
    },
    headers: (params) => contextDevHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        success: data.success ?? true,
        images: data.images ?? [],
        url: data.url ?? '',
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the scrape succeeded' },
    images: {
      type: 'array',
      description: 'Discovered image assets with source, element, type, and optional enrichment',
      items: { type: 'object', properties: IMAGE_OUTPUT_PROPERTIES },
    },
    url: { type: 'string', description: 'The scraped URL' },
    ...CREDIT_OUTPUTS,
  },
}
