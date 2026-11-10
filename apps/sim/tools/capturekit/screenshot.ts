import type {
  CaptureKitScreenshotParams,
  CaptureKitScreenshotResponse,
} from '@/tools/capturekit/types'
import type { ToolConfig } from '@/tools/types'

export const capturekitScreenshotTool: ToolConfig<
  CaptureKitScreenshotParams,
  CaptureKitScreenshotResponse
> = {
  id: 'capturekit_screenshot',
  name: 'CaptureKit Take Screenshot',
  description:
    'Capture a public web page as a PNG, JPEG, WebP image or a PDF, by viewport, full page or CSS selector, and store it as a file.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page (e.g., "https://example.com")',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: png, jpeg, webp or pdf (defaults to "png")',
    },
    fullPage: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Capture the entire page instead of the visible viewport',
    },
    device: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device to emulate (e.g., "iphone_14_pro")',
    },
    selector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CSS selector of one element to capture (e.g., "#pricing")',
    },
    viewportWidth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width of the browser viewport in pixels (defaults to 1280)',
    },
    viewportHeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Height of the browser viewport in pixels (defaults to 1024)',
    },
    delay: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds to wait before capturing (defaults to 0)',
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
    responseType: 'binary',
    url: (params) => {
      const url = new URL(`https://api.capturekit.dev/v1/capture`)
      url.searchParams.set('url', params.url.trim())
      if (params.format?.trim()) url.searchParams.set('format', params.format.trim())
      if (params.fullPage != null) url.searchParams.set('full_page', String(params.fullPage))
      if (params.device?.trim()) url.searchParams.set('device', params.device.trim())
      if (params.selector?.trim()) url.searchParams.set('selector', params.selector.trim())
      if (params.viewportWidth != null)
        url.searchParams.set('viewport_width', String(params.viewportWidth))
      if (params.viewportHeight != null)
        url.searchParams.set('viewport_height', String(params.viewportHeight))
      if (params.delay != null) url.searchParams.set('delay', String(params.delay))
      if (params.removeCookieBanners != null)
        url.searchParams.set('remove_cookie_banners', String(params.removeCookieBanners))
      if (params.removeAds != null) url.searchParams.set('remove_ads', String(params.removeAds))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: '*/*',
    }),
  },

  transformResponse: async (response) => {
    const data = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
    const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    return {
      success: true,
      output: {
        file: { name: `screenshot.${extension}`, mimeType, data, size: data.length },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Screenshot or PDF of the page, stored in the execution files',
    },
  },
}
