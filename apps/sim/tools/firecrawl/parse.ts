import type { ParseParams, ParseResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const parseTool: ToolConfig<ParseParams, ParseResponse> = {
  id: 'firecrawl_parse',
  name: 'Firecrawl Document Parser',
  description:
    'Parse uploaded documents (PDF, DOCX, HTML, etc.) into clean markdown using Firecrawl. Supports .html, .htm, .pdf, .docx, .doc, .odt, .rtf, .xlsx, .xls.',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Document file to be parsed',
    },
    formats: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output formats to return (e.g., ["markdown"]). Defaults to markdown.',
    },
    onlyMainContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude headers, navs, footers. Defaults to true.',
    },
    includeTags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML tags to include',
    },
    excludeTags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML tags to exclude',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in milliseconds (max 300000). Defaults to 30000.',
    },
    parsers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parser configuration (e.g., [{ "type": "pdf" }])',
    },
    removeBase64Images: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove base64 images, keep alt text. Defaults to true.',
    },
    blockAds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Block ads and popups. Defaults to true.',
    },
    proxy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Proxy mode: "basic" or "auto"',
    },
    zeroDataRetention: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable zero data retention. Defaults to false.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  hosting: {
    envKeyPrefix: 'FIRECRAWL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'firecrawl',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const creditsUsed = (output.metadata as { creditsUsed?: number })?.creditsUsed
        if (creditsUsed == null) {
          throw new Error('Firecrawl response missing creditsUsed field')
        }

        if (Number.isNaN(creditsUsed)) {
          throw new Error('Firecrawl response returned a non-numeric creditsUsed field')
        }

        return {
          cost: creditsUsed * 0.001,
          metadata: { creditsUsed },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/firecrawl/parse',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.apiKey || typeof params.apiKey !== 'string' || params.apiKey.trim() === '') {
        throw new Error('Missing or invalid API key: A valid Firecrawl API key is required')
      }
      if (!params.file || typeof params.file !== 'object') {
        throw new Error('File input is required')
      }

      const options: Record<string, unknown> = {}
      if (params.formats) options.formats = params.formats
      if (typeof params.onlyMainContent === 'boolean')
        options.onlyMainContent = params.onlyMainContent
      if (params.includeTags) options.includeTags = params.includeTags
      if (params.excludeTags) options.excludeTags = params.excludeTags
      if (params.timeout != null) options.timeout = Number(params.timeout)
      if (params.parsers) options.parsers = params.parsers
      if (typeof params.removeBase64Images === 'boolean')
        options.removeBase64Images = params.removeBase64Images
      if (typeof params.blockAds === 'boolean') options.blockAds = params.blockAds
      if (params.proxy) options.proxy = params.proxy
      if (typeof params.zeroDataRetention === 'boolean')
        options.zeroDataRetention = params.zeroDataRetention

      return {
        apiKey: params.apiKey,
        file: params.file,
        options,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format from Firecrawl parse API')
    }

    const result = data.output ?? data.data ?? data

    return {
      success: true,
      output: {
        markdown: result.markdown ?? '',
        summary: result.summary ?? null,
        html: result.html ?? null,
        rawHtml: result.rawHtml ?? null,
        screenshot: result.screenshot ?? null,
        links: result.links ?? [],
        metadata: result.metadata ?? null,
        warning: result.warning ?? null,
      },
    }
  },

  outputs: {
    markdown: { type: 'string', description: 'Parsed document content in markdown format' },
    summary: {
      type: 'string',
      description: 'Generated summary of the document',
      optional: true,
    },
    html: {
      type: 'string',
      description: 'Processed HTML content',
      optional: true,
    },
    rawHtml: {
      type: 'string',
      description: 'Unprocessed raw HTML content',
      optional: true,
    },
    screenshot: {
      type: 'string',
      description: 'Screenshot URL or base64 (when requested)',
      optional: true,
    },
    links: {
      type: 'array',
      description: 'URLs discovered in the document',
      optional: true,
      items: { type: 'string', description: 'Discovered URL' },
    },
    metadata: {
      type: 'object',
      description: 'Document metadata',
      optional: true,
      properties: {
        title: { type: 'string', description: 'Document title', optional: true },
        description: { type: 'string', description: 'Document description', optional: true },
        language: { type: 'string', description: 'Document language code', optional: true },
        sourceURL: { type: 'string', description: 'Source URL', optional: true },
        url: { type: 'string', description: 'Final URL', optional: true },
        keywords: { type: 'string', description: 'Document keywords', optional: true },
        statusCode: { type: 'number', description: 'HTTP status code', optional: true },
        contentType: { type: 'string', description: 'Document content type', optional: true },
        error: { type: 'string', description: 'Error message if parse failed', optional: true },
      },
    },
    warning: {
      type: 'string',
      description: 'Warning message from the parse operation',
      optional: true,
    },
  },
}
