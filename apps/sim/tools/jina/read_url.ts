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
    targetSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'CSS selector to target specific page elements (e.g., "#main-content")',
    },
    waitForSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'CSS selector to wait for before extracting content (useful for dynamic pages)',
    },
    removeSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'CSS selector for elements to exclude (e.g., "header, footer, .ad")',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum seconds to wait for page load',
    },
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
    // Authentication & proxy
    setCookie: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Forward authentication cookies (disables caching)',
    },
    proxyUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTP proxy URL for request routing',
    },
    proxy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Country code for proxy (e.g., "US", "UK") or "auto"/"none"',
    },
    // Performance & caching
    engine: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Rendering engine: browser, direct, or cf-browser-rendering',
    },
    tokenBudget: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum tokens for the request (cost control)',
    },
    noCache: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Bypass cached content for real-time retrieval',
    },
    cacheTolerance: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Custom cache lifetime in seconds',
    },
    // Advanced options
    withGeneratedAlt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Generate alt text for images using VLM',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Set to "final" to follow redirect chain',
    },
    locale: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Browser locale for rendering (e.g., "en-US")',
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
      if (params.targetSelector) {
        headers['X-Target-Selector'] = params.targetSelector
      }
      if (params.waitForSelector) {
        headers['X-Wait-For-Selector'] = params.waitForSelector
      }
      if (params.removeSelector) {
        headers['X-Remove-Selector'] = params.removeSelector
      }
      if (params.timeout) {
        headers['X-Timeout'] = Number(params.timeout).toString()
      }
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

      // Authentication & proxy headers
      if (params.setCookie) {
        headers['X-Set-Cookie'] = params.setCookie
      }
      if (params.proxyUrl) {
        headers['X-Proxy-Url'] = params.proxyUrl
      }
      if (params.proxy) {
        headers['X-Proxy'] = params.proxy
      }

      // Performance & caching headers
      if (params.engine) {
        headers['X-Engine'] = params.engine
      }
      if (params.tokenBudget) {
        headers['X-Token-Budget'] = Number(params.tokenBudget).toString()
      }
      if (params.noCache === true) {
        headers['X-No-Cache'] = 'true'
      }
      if (params.cacheTolerance) {
        headers['X-Cache-Tolerance'] = Number(params.cacheTolerance).toString()
      }

      // Advanced options
      if (params.withGeneratedAlt === true) {
        headers['X-With-Generated-Alt'] = 'true'
      }
      if (params.baseUrl) {
        headers['X-Base'] = params.baseUrl
      }
      if (params.locale) {
        headers['X-Locale'] = params.locale
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
