import { toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { YouComGetContentsParams, YouComGetContentsResponse } from '@/tools/youcom/types'
import {
  optionalNumber,
  parseList,
  YOUCOM_INDEX_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComGetContentsTool: ToolConfig<YouComGetContentsParams, YouComGetContentsResponse> =
  {
    id: 'youcom_get_contents',
    name: 'You.com Get Contents',
    description:
      'Fetch the HTML, Markdown, and page metadata of one or more web pages with You.com.',
    version: '1.0.0',

    params: {
      urls: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated URLs to fetch content from',
      },
      formats: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated formats to return: markdown, html, metadata (JSON-LD and OpenGraph site info)',
      },
      crawlTimeout: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Seconds to wait for page content, from 1 to 60. Defaults to 10',
      },
      maxAge: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Maximum age in seconds of cached content before the page is re-fetched. Defaults to no limit',
      },
      apiKey: youComApiKeyParam,
    },

    request: {
      url: `${YOUCOM_INDEX_BASE_URL}/contents`,
      method: 'POST',
      headers: youComHeaders,
      body: (params) => {
        const urls = parseList(params.urls)
        if (!urls) throw new Error('At least one URL is required')

        const body: Record<string, unknown> = { urls }
        const formats = parseList(params.formats)
        if (formats) body.formats = formats
        const crawlTimeout = optionalNumber(params.crawlTimeout)
        if (crawlTimeout !== undefined) body.crawl_timeout = crawlTimeout
        const maxAge = optionalNumber(params.maxAge)
        if (maxAge !== undefined) body.max_age = maxAge
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!Array.isArray(data)) {
        throw new Error('Unexpected You.com Contents response: expected an array of pages')
      }

      return {
        success: true,
        output: {
          pages: data.map((item) => {
            const page = toRecordOrNull(item) ?? {}
            const metadata = toRecordOrNull(page.metadata) ?? {}
            return {
              url: toStringOrNull(page.url),
              title: toStringOrNull(page.title),
              html: toStringOrNull(page.html),
              markdown: toStringOrNull(page.markdown),
              siteName: toStringOrNull(metadata.site_name),
              faviconUrl: toStringOrNull(metadata.favicon_url),
            }
          }),
        },
      }
    },

    outputs: {
      pages: {
        type: 'array',
        description: 'Content of each fetched page',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL of the fetched page', nullable: true },
            title: { type: 'string', description: 'Title of the page', nullable: true },
            html: { type: 'string', description: 'Page HTML (html format)', nullable: true },
            markdown: {
              type: 'string',
              description: 'Page Markdown (markdown format)',
              nullable: true,
            },
            siteName: {
              type: 'string',
              description: 'OpenGraph site name (metadata format)',
              nullable: true,
            },
            faviconUrl: {
              type: 'string',
              description: "Favicon URL of the page's domain (metadata format)",
              nullable: true,
            },
          },
        },
      },
    },
  }
