import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, isRecordLike } from '@sim/utils/object'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { MrScraperScrapeParams, MrScraperScrapeResponse } from '@/tools/mrscraper/types'
import {
  getMrScraperError,
  getMrScraperHeaders,
  getMrScraperNumber,
  requireMrScraperObject,
  validateMrScraperBoolean,
  validateMrScraperInteger,
} from '@/tools/mrscraper/utils'
import type { ToolConfig, ToolFileData } from '@/tools/types'

function getTargetUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('URL must be an absolute HTTP or HTTPS URL.')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('URL must be an absolute HTTP or HTTPS URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must be an absolute HTTP or HTTPS URL.')
  }
  return url.toString()
}

function getTargetHeaders(value: MrScraperScrapeParams['headers']): string | undefined {
  if (value === undefined || value === '') return undefined
  const headers: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (
    !isRecordLike(headers) ||
    Object.values(headers).some((header) => typeof header !== 'string')
  ) {
    throw new Error('Headers must be a JSON object with string values.')
  }
  return JSON.stringify(headers)
}

/**
 * Markdown requests go to the browser scraper, which takes a POST body and answers with JSON.
 * Everything else goes to the fetch endpoint, which is a GET: it replays the request method
 * against the target, so a POST there is rejected by sites that only accept GET.
 */
function usesBrowserScraper(params: MrScraperScrapeParams): boolean {
  return validateMrScraperBoolean(params.markdown, 'Markdown') === true
}

function getScreenshot(value: unknown): ToolFileData | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('MrScraper returned an invalid base64 screenshot.')
  }
  const size = Buffer.byteLength(value, 'base64')
  assertKnownSizeWithinLimit(size, MAX_BUFFERED_TRANSFER_BYTES, 'MrScraper screenshot')
  const isPng = value.startsWith('iVBORw0KGgo')
  return {
    name: isPng ? 'screenshot.png' : 'screenshot.jpg',
    mimeType: isPng ? 'image/png' : 'image/jpeg',
    data: Buffer.from(value, 'base64'),
    size,
  }
}

function getHeaderNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  return value ? getMrScraperNumber(Number(value)) : null
}

export const mrScraperScrapeTool: ToolConfig<MrScraperScrapeParams, MrScraperScrapeResponse> = {
  id: 'mrscraper_scrape',
  name: 'MrScraper Scrape',
  description:
    'Retrieve a web page as HTML, Markdown, or a screenshot with automatic browser fallback, optional real-device routing, geolocation, and retry controls.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MrScraper API key from https://app.mrscraper.com.',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Absolute HTTP or HTTPS URL of the page to retrieve.',
    },
    html: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Include HTML content. Defaults to true.',
    },
    markdown: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: false,
      description: 'Include Markdown content.',
    },
    screenshot: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: false,
      description:
        'Capture a full-page screenshot as a stored file. Always enables browser rendering.',
    },
    browserRendering: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'auto',
      description:
        'auto uses automatic browser fallback; true forces a browser; false disables it.',
    },
    super: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use real-device routing independently of browser rendering.',
    },
    geoCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'US',
      description: 'Proxy country code, such as US, GB, ID, or SG. Defaults to US.',
    },
    proxyCountry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compatibility country option sent as proxyCountry.',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 120,
      description: 'Page timeout in seconds, from 1 to 300. Defaults to 120.',
    },
    maxRetries: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 3,
      description:
        'Maximum retry count for Markdown requests. Zero disables retries. Defaults to 3.',
    },
    tokenCap: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Token budget, at least 1, for a Markdown request and its retries. The initial request always runs.',
    },
    waitForSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CSS selector to wait for when browser rendering is enabled.',
    },
    blockResources: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Block images, CSS, and fonts to reduce bandwidth.',
    },
    homePage: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Visit the site root before loading the target URL.',
    },
    useProxy: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Allow the service to use a configured proxy. Defaults to true.',
    },
    proxy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom proxy in username:password@host:port form.',
    },
    bypassProxy: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable the API proxy-bypass behavior.',
    },
    cookieJar: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Cookie configuration, such as domain=example.com&country=us&max_used=100&max_age=50m.',
    },
    headers: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Target page request headers as a JSON object with string values.',
    },
  },
  request: {
    method: (params) => (usesBrowserScraper(params) ? 'POST' : 'GET'),
    url: (params) => {
      const rendering = params.browserRendering ?? 'auto'
      if (!['auto', 'true', 'false'].includes(rendering)) {
        throw new Error('Browser rendering must be auto, true, or false.')
      }
      const screenshot = validateMrScraperBoolean(params.screenshot, 'Screenshot')
      const browserScraper = usesBrowserScraper(params)
      const query = filterUndefined({
        url: browserScraper ? undefined : getTargetUrl(params.url),
        html: validateMrScraperBoolean(params.html, 'HTML') ?? true,
        markdown: browserScraper,
        screenshot: screenshot ? 'full' : undefined,
        browserRendering: screenshot
          ? true
          : rendering === 'auto'
            ? undefined
            : rendering === 'true',
        super: validateMrScraperBoolean(params.super, 'Super mode'),
        geoCode: params.geoCode?.trim() || 'US',
        proxyCountry: params.proxyCountry?.trim() || undefined,
        timeout: validateMrScraperInteger(params.timeout, 'Timeout', 1, 300) ?? 120,
        waitForSelector: params.waitForSelector || undefined,
        blockResources: validateMrScraperBoolean(params.blockResources, 'Block resources'),
        warmStart: validateMrScraperBoolean(params.homePage, 'Home page'),
        useProxy: validateMrScraperBoolean(params.useProxy, 'Use proxy'),
        proxy: params.proxy || undefined,
        bypassProxy: validateMrScraperBoolean(params.bypassProxy, 'Bypass proxy'),
        cookieJar: params.cookieJar || undefined,
        headers: getTargetHeaders(params.headers),
      })
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) search.set(key, String(value))
      return `https://api.mrscraper.com/?${search.toString()}`
    },
    headers: (params) => getMrScraperHeaders(params.apiKey),
    body: (params) =>
      filterUndefined({
        url: getTargetUrl(params.url),
        maxRetries: validateMrScraperInteger(params.maxRetries, 'Maximum retries', 0) ?? 3,
        tokenCap: validateMrScraperInteger(params.tokenCap, 'Token cap', 1),
      }),
  },
  transformResponse: async (response, params) => {
    const includeHtml = params?.html !== false
    const metrics = {
      tokenUsage: getHeaderNumber(response.headers, 'token_usage'),
      runtime: getHeaderNumber(response.headers, 'runtime'),
      retryCount: getHeaderNumber(response.headers, 'retry_count'),
      targetStatusCode: getHeaderNumber(response.headers, 'x-status-code'),
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return {
        success: true,
        output: {
          html: includeHtml ? await response.text() : null,
          markdown: null,
          ...metrics,
          error: null,
        },
      }
    }
    const data = requireMrScraperObject(await response.json(), 'page response')
    const error = getMrScraperError(data)
    return {
      success: !error,
      ...(error ? { error } : {}),
      output: {
        html: includeHtml ? toStringOrNull(data.html) : null,
        markdown: params?.markdown === true ? toStringOrNull(data.markdown) : null,
        screenshot: error ? undefined : getScreenshot(data.screenshot),
        tokenUsage: getMrScraperNumber(data.token_usage) ?? metrics.tokenUsage,
        runtime: getMrScraperNumber(data.runtime) ?? metrics.runtime,
        retryCount: getMrScraperNumber(data.retry_count) ?? metrics.retryCount,
        targetStatusCode: metrics.targetStatusCode,
        error,
      },
    }
  },
  outputs: {
    html: { type: 'string', description: 'Page HTML, when requested.', nullable: true },
    markdown: { type: 'string', description: 'Page Markdown, when requested.', nullable: true },
    screenshot: {
      type: 'file',
      description: 'Page screenshot (PNG or JPEG) stored in execution files.',
      optional: true,
    },
    tokenUsage: {
      type: 'number',
      description: 'Plan tokens consumed by the page request.',
      nullable: true,
    },
    runtime: { type: 'number', description: 'Page request runtime in seconds.', nullable: true },
    retryCount: { type: 'number', description: 'Number of retries performed.', nullable: true },
    targetStatusCode: {
      type: 'number',
      description: 'Target page HTTP status from x-status-code.',
      nullable: true,
    },
    error: {
      type: 'string',
      description: 'Page retrieval error, when reported by MrScraper.',
      nullable: true,
    },
  },
}
