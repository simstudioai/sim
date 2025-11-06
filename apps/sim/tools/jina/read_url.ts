import type { ReadUrlParams, ReadUrlResponse } from '@/tools/jina/types'
import type { ToolConfig } from '@/tools/types'

export const readUrlTool: ToolConfig<ReadUrlParams, ReadUrlResponse> = {
  id: 'jina_read_url',
  name: 'Jina Reader',
  description:
    'Extract and process web content into clean, LLM-friendly text using Jina AI Reader. Supports advanced content parsing, link gathering, and multiple output formats with configurable processing options.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to read and convert to markdown',
    },
    useReaderLMv2: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to use ReaderLM-v2 for better quality (3x token cost)',
    },
    gatherLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to gather all links at the end',
    },
    jsonResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to return response in JSON format',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jina AI API key',
    },
    // Content extraction params
    withImagesummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Gather all images from the page with metadata',
    },
    retainImages: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Control image inclusion: "none" removes all, "all" keeps all',
    },
    returnFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format: markdown, html, text, screenshot, or pageshot',
    },
    withIframe: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include iframe content in extraction',
    },
    withShadowDom: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extract Shadow DOM content',
    },
    // Performance & caching
    noCache: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Bypass cached content for real-time retrieval',
    },
    // Advanced options
    withGeneratedAlt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Generate alt text for images using VLM',
    },
    robotsTxt: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot User-Agent for robots.txt checking',
    },
    dnt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Do Not Track - prevents caching/tracking',
    },
    noGfm: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Disable GitHub Flavored Markdown',
    },
  },

  request: {
    url: (params: ReadUrlParams) => {
      return `https://r.jina.ai/https://${params.url.replace(/^https?:\/\//, '')}`
    },
    method: 'GET',
    headers: (params: ReadUrlParams) => {
      // Start with base headers
      const headers: Record<string, string> = {
        Accept: params.jsonResponse ? 'application/json' : 'text/plain',
        Authorization: `Bearer ${params.apiKey}`,
      }

      // Legacy params (backward compatible)
      if (params.useReaderLMv2 === true) {
        headers['X-Respond-With'] = 'readerlm-v2'
      }
      if (params.gatherLinks === true) {
        headers['X-With-Links-Summary'] = 'true'
      }

      // Content extraction headers
      if (params.withImagesummary === true) {
        headers['X-With-Images-Summary'] = 'true'
      }
      if (params.retainImages) {
        headers['X-Retain-Images'] = params.retainImages
      }
      if (params.returnFormat) {
        headers['X-Return-Format'] = params.returnFormat
      }
      if (params.withIframe === true) {
        headers['X-With-Iframe'] = 'true'
      }
      if (params.withShadowDom === true) {
        headers['X-With-Shadow-Dom'] = 'true'
      }

      // Advanced options
      if (params.withGeneratedAlt === true) {
        headers['X-With-Generated-Alt'] = 'true'
      }
      if (params.robotsTxt) {
        headers['X-Robots-Txt'] = params.robotsTxt
      }
      if (params.dnt === true) {
        headers.DNT = '1'
      }
      if (params.noGfm === true) {
        headers['X-No-Gfm'] = 'true'
      }

      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type')

    if (contentType?.includes('application/json')) {
      const data = await response.json()
      return {
        success: response.ok,
        output: {
          content: data.data?.content || data.content || JSON.stringify(data),
          links: data.data?.links || undefined,
          images: data.data?.images || undefined,
        },
      }
    }

    const content = await response.text()
    return {
      success: response.ok,
      output: {
        content,
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The extracted content from the URL, processed into clean, LLM-friendly text',
    },
    links: {
      type: 'array',
      description:
        'List of links found on the page (when gatherLinks or withLinksummary is enabled)',
    },
    images: {
      type: 'array',
      description: 'List of images found on the page (when withImagesummary is enabled)',
    },
  },
}
