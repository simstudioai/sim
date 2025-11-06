import type { ExtractParams, ExtractResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const extractTool: ToolConfig<ExtractParams, ExtractResponse> = {
  id: 'firecrawl_extract',
  name: 'Firecrawl Extract',
  description:
    'Extract structured data from entire webpages using natural language prompts and JSON schema. Powerful agentic feature for intelligent data extraction.',
  version: '1.0.0',

  params: {
    urls: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of URLs to extract data from (supports glob format)',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language guidance for the extraction process',
    },
    schema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON Schema defining the structure of data to extract',
    },
    enableWebSearch: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable web search to find supplementary information (default: false)',
    },
    ignoreSitemap: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Ignore sitemap.xml files during scanning (default: false)',
    },
    includeSubdomains: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Extend scanning to subdomains (default: true)',
    },
    showSources: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Return data sources in the response (default: false)',
    },
    ignoreInvalidURLs: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Skip invalid URLs in the array (default: true)',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scraping configuration options',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v1/extract',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        urls: params.urls,
      }

      if (params.prompt !== undefined) body.prompt = params.prompt
      if (params.schema !== undefined) body.schema = params.schema
      if (params.enableWebSearch !== undefined) body.enableWebSearch = params.enableWebSearch
      if (params.ignoreSitemap !== undefined) body.ignoreSitemap = params.ignoreSitemap
      if (params.includeSubdomains !== undefined) body.includeSubdomains = params.includeSubdomains
      if (params.showSources !== undefined) body.showSources = params.showSources
      if (params.ignoreInvalidURLs !== undefined) body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions !== undefined) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: data.success,
      output: {
        success: data.success,
        data: data.data || {},
        sources: data.sources,
        warning: data.warning,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the extraction operation was successful',
    },
    data: {
      type: 'object',
      description: 'Extracted structured data according to the schema or prompt',
    },
    sources: {
      type: 'array',
      description: 'Data sources (only if showSources is enabled)',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Source URL' },
          title: { type: 'string', description: 'Source title' },
        },
      },
    },
    warning: {
      type: 'string',
      description: 'Warning messages from the extraction operation',
    },
  },
}
