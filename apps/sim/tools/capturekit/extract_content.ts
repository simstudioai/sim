import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  CaptureKitExtractContentParams,
  CaptureKitExtractContentResponse,
} from '@/tools/capturekit/types'
import {
  CAPTURE_KIT_PAGE_LINKS_OUTPUT_PROPERTIES,
  CAPTURE_KIT_PAGE_METADATA_OUTPUT_PROPERTIES,
} from '@/tools/capturekit/types'
import { mapCaptureKitPageLinks, mapCaptureKitPageMetadata } from '@/tools/capturekit/utils'
import type { ToolConfig } from '@/tools/types'

export const capturekitExtractContentTool: ToolConfig<
  CaptureKitExtractContentParams,
  CaptureKitExtractContentResponse
> = {
  id: 'capturekit_extract_content',
  name: 'CaptureKit Extract Content',
  description:
    'Render a web page and get its title, description, favicon, Open Graph image, internal, external and social links, and optionally its Markdown.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page (e.g., "https://example.com")',
    },
    includeMarkdown: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the page content as Markdown',
    },
    removeCookieBanners: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove cookie banners before capturing',
    },
    removeAds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove ads before capturing',
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
      const url = new URL(`https://api.capturekit.dev/v1/content`)
      url.searchParams.set('url', params.url.trim())
      if (params.includeMarkdown != null)
        url.searchParams.set('include_markdown', String(params.includeMarkdown))
      if (params.removeCookieBanners != null)
        url.searchParams.set('remove_cookie_banners', String(params.removeCookieBanners))
      if (params.removeAds != null) url.searchParams.set('remove_ads', String(params.removeAds))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        metadata: mapCaptureKitPageMetadata(toRecord(data.data).metadata),
        links: mapCaptureKitPageLinks(toRecord(data.data).links),
        markdown: toStringOrNull(toRecord(data.data).markdown),
      },
    }
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Page metadata',
      optional: true,
      properties: CAPTURE_KIT_PAGE_METADATA_OUTPUT_PROPERTIES,
    },
    links: {
      type: 'object',
      description: 'Links found on the page',
      optional: true,
      properties: CAPTURE_KIT_PAGE_LINKS_OUTPUT_PROPERTIES,
    },
    markdown: {
      type: 'string',
      description: 'Page content as Markdown, when requested',
      optional: true,
    },
  },
}
