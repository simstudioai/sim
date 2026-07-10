import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevScreenshotParams,
  ContextDevScreenshotResponse,
} from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig, ToolFileData } from '@/tools/types'

/** Maps a lowercase image file extension to its MIME type. */
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

/**
 * Derives the file extension and MIME type for a stored screenshot from its URL,
 * falling back to PNG when the URL has no recognizable image extension.
 */
function screenshotFileMeta(url: string): { extension: string; mimeType: string } {
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    if (IMAGE_MIME_BY_EXTENSION[ext]) {
      return { extension: ext, mimeType: IMAGE_MIME_BY_EXTENSION[ext] }
    }
  } catch {
    // Unparseable URL — fall back to the default below.
  }
  return { extension: 'png', mimeType: 'image/png' }
}

export const contextDevScreenshotTool: ToolConfig<
  ContextDevScreenshotParams,
  ContextDevScreenshotResponse
> = {
  id: 'context_dev_screenshot',
  name: 'Context.dev Screenshot',
  description: 'Capture a screenshot of any web page and store it as a downloadable image file.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevScreenshotParams>(),

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The full URL to capture (must include http:// or https://)',
    },
    fullScreenshot: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Capture the full scrollable page instead of just the viewport (default: false)',
    },
    handleCookiePopup: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attempt to dismiss cookie banners before capturing (default: false)',
    },
    viewportWidth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Viewport width in pixels (240-7680, default: 1920)',
    },
    viewportHeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Viewport height in pixels (240-4320, default: 1080)',
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
      description: 'Post-load delay before capturing in milliseconds (0-30000, default: 3000)',
    },
    timeoutMS: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request timeout in milliseconds (1000-300000)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/screenshot`)
      appendParam(url.searchParams, 'directUrl', params.url)
      appendParam(url.searchParams, 'fullScreenshot', params.fullScreenshot)
      appendParam(url.searchParams, 'handleCookiePopup', params.handleCookiePopup)
      appendParam(url.searchParams, 'viewport[width]', params.viewportWidth)
      appendParam(url.searchParams, 'viewport[height]', params.viewportHeight)
      appendParam(url.searchParams, 'maxAgeMs', params.maxAgeMs)
      appendParam(url.searchParams, 'waitForMs', params.waitForMs)
      appendParam(url.searchParams, 'timeoutMS', params.timeoutMS)
      return url.toString()
    },
    headers: (params) => contextDevHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    const screenshotUrl: string = data.screenshot ?? ''
    const domain: string | null = data.domain ?? null

    const { extension, mimeType } = screenshotFileMeta(screenshotUrl)
    const file: ToolFileData | undefined = screenshotUrl
      ? {
          name: `${domain ?? 'screenshot'}.${extension}`,
          mimeType,
          url: screenshotUrl,
        }
      : undefined

    return {
      success: true,
      output: {
        ...(file ? { file } : {}),
        screenshotUrl,
        screenshotType: data.screenshotType ?? null,
        domain,
        width: data.width ?? null,
        height: data.height ?? null,
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    file: { type: 'file', description: 'Stored screenshot image file', optional: true },
    screenshotUrl: { type: 'string', description: 'Public URL of the captured screenshot' },
    screenshotType: {
      type: 'string',
      description: 'Screenshot type (viewport or fullPage)',
      optional: true,
    },
    domain: { type: 'string', description: 'Domain that was captured', optional: true },
    width: { type: 'number', description: 'Screenshot width in pixels', optional: true },
    height: { type: 'number', description: 'Screenshot height in pixels', optional: true },
    ...CREDIT_OUTPUTS,
  },
}
