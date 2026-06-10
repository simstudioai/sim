import type { ToolConfig } from '@/tools/types'
import type { YouContentsParams, YouContentsResponse } from '@/tools/you/types'

function parseUrls(urls: string): string[] {
  return urls
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
}

function resolveFormats(format?: string): string[] {
  switch (format) {
    case 'html':
      return ['html', 'metadata']
    case 'both':
      return ['markdown', 'html', 'metadata']
    default:
      return ['markdown', 'metadata']
  }
}

export const contentsTool: ToolConfig<YouContentsParams, YouContentsResponse> = {
  id: 'you_contents',
  name: 'You.com Contents',
  description:
    'Extract clean page content from one or more URLs with You.com. Returns Markdown and/or HTML plus structured metadata for each page.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'YOU_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'you',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        if (!Array.isArray(output.results)) {
          throw new Error('You.com contents response missing results array')
        }
        // You.com Contents: $1/1k pages
        // https://you.com/pricing
        const pageCount = output.results.length
        const cost = pageCount * 0.001
        return { cost, metadata: { pageCount } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of webpage URLs to extract content from (up to 100)',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format: markdown (default), html, or both',
    },
    crawl_timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum seconds to wait per page (1-60, default: 10)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'You.com API Key',
    },
  },

  request: {
    url: 'https://ydc-index.io/v1/contents',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-API-Key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        urls: parseUrls(params.urls),
        formats: resolveFormats(params.format),
      }
      if (params.crawl_timeout) body.crawl_timeout = Number(params.crawl_timeout)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`You.com contents failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const items = (Array.isArray(data) ? data : (data.output ?? data.results ?? [])) as Record<
      string,
      unknown
    >[]

    return {
      success: true,
      output: {
        results: items.map((item) => ({
          url: (item.url as string | undefined) ?? null,
          title: (item.title as string | undefined) ?? null,
          markdown: (item.markdown as string | undefined) ?? null,
          html: (item.html as string | undefined) ?? null,
          metadata: (item.metadata as Record<string, unknown> | undefined) ?? null,
        })),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Extracted content for each requested URL',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The webpage URL' },
          title: { type: 'string', description: 'The page title', optional: true },
          markdown: {
            type: 'string',
            description: 'Markdown content (if requested)',
            optional: true,
          },
          html: { type: 'string', description: 'HTML content (if requested)', optional: true },
          metadata: {
            type: 'json',
            description: 'Structured metadata (site_name, favicon_url) for each page',
            optional: true,
          },
        },
      },
    },
  },
}
