import { tinyfishFetchHosting } from '@/tools/tinyfish/hosting'
import type {
  TinyFishFetchParams,
  TinyFishFetchResponse,
  TinyFishRawFetch,
} from '@/tools/tinyfish/types'
import {
  MAX_FETCH_URLS,
  parseList,
  TINYFISH_FETCH_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

export const fetchUrlsTool: ToolConfig<TinyFishFetchParams, TinyFishFetchResponse> = {
  id: 'tinyfish_fetch',
  name: 'TinyFish Fetch',
  description:
    'Fetch up to 10 URLs with TinyFish, rendering JavaScript when needed, and return clean extracted content',
  version: '1.0.0',

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of 1-10 URLs to fetch',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Extraction format: "markdown" (default), "html", or "json"',
    },
    links: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Also return every outbound link found on each page',
    },
    imageLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Also return every image URL found on each page',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  hosting: tinyfishFetchHosting(),

  request: {
    url: `${TINYFISH_FETCH_API_BASE}/`,
    method: 'POST',
    headers: (params) => tinyfishHeaders(params.apiKey),
    body: (params) => {
      const urls = parseList(params.urls)
      /**
       * TinyFish rejects an empty or over-long list with a generic 400, so the
       * documented 1-10 bound is checked here to name the actual problem.
       */
      if (urls.length === 0) {
        throw new Error('At least one URL is required')
      }
      if (urls.length > MAX_FETCH_URLS) {
        throw new Error(`TinyFish Fetch accepts at most ${MAX_FETCH_URLS} URLs per request`)
      }

      const body: Record<string, unknown> = { urls }
      if (params.format) body.format = params.format
      if (params.links) body.links = true
      if (params.imageLinks) body.image_links = true
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = (await response.json()) as TinyFishRawFetch

    return {
      success: true,
      output: {
        results: (data.results ?? []).map((result) => ({
          url: result?.url ?? '',
          finalUrl: result?.final_url ?? null,
          title: result?.title ?? null,
          description: result?.description ?? null,
          language: result?.language ?? null,
          format: result?.format ?? 'markdown',
          text: result?.text ?? null,
          author: result?.author ?? null,
          publishedDate: result?.published_date ?? null,
          links: result?.links ?? [],
          imageLinks: result?.image_links ?? [],
          latencyMs: result?.latency_ms ?? null,
        })),
        errors: (data.errors ?? []).map((issue) => ({
          url: issue?.url ?? '',
          error: issue?.error ?? '',
        })),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Successfully fetched pages',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL that was requested' },
          finalUrl: { type: 'string', description: 'URL after redirects', optional: true },
          title: { type: 'string', description: 'Page title', optional: true },
          description: { type: 'string', description: 'Meta description', optional: true },
          language: { type: 'string', description: 'Detected language code', optional: true },
          format: { type: 'string', description: 'Format of the extracted content' },
          text: {
            type: 'json',
            description:
              'Extracted content — a string for markdown and html, a document tree for json',
            optional: true,
          },
          author: { type: 'string', description: 'Page author', optional: true },
          publishedDate: { type: 'string', description: 'Published date', optional: true },
          links: {
            type: 'array',
            description: 'Outbound links, only when links was requested',
            items: { type: 'string', description: 'Absolute link URL' },
          },
          imageLinks: {
            type: 'array',
            description: 'Image URLs, only when image links were requested',
            items: { type: 'string', description: 'Absolute image URL' },
          },
          latencyMs: { type: 'number', description: 'Fetch latency in ms', optional: true },
        },
      },
    },
    errors: {
      type: 'array',
      description: 'URLs that failed. A per-URL failure never fails the whole request',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL that failed' },
          error: { type: 'string', description: 'Why the fetch failed' },
        },
      },
    },
  },
}
