import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, isRecordLike } from '@sim/utils/object'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { MrScraperScrapeParams, MrScraperScrapeResponse } from '@/tools/mrscraper/types'
import {
  getMrScraperError,
  getMrScraperHeaders,
  getMrScraperNumber,
  requireMrScraperApiKey,
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

function getScreenshot(value: unknown): ToolFileData | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('MrScraper returned an invalid base64 JPEG screenshot.')
  }
  const size = Buffer.byteLength(value, 'base64')
  assertKnownSizeWithinLimit(size, MAX_BUFFERED_TRANSFER_BYTES, 'MrScraper screenshot')
  return {
    name: 'screenshot.jpg',
    mimeType: 'image/jpeg',
    data: Buffer.from(value, 'base64'),
    size,
  }
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
      description: 'Capture a JPEG screenshot as a stored file. Always enables browser rendering.',
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
        'Maximum retry count as a nonnegative integer. Zero disables retries. Defaults to 3.',
    },
    tokenCap: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Nonnegative retry-token budget. The initial request always runs.',
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
    method: 'POST',
    url: (params) => {
      const rendering = params.browserRendering ?? 'auto'
      if (!['auto', 'true', 'false'].includes(rendering)) {
        throw new Error('Browser rendering must be auto, true, or false.')
      }
      const screenshot = validateMrScraperBoolean(params.screenshot, 'Screenshot')
      const query = filterUndefined({
        token: requireMrScraperApiKey(params.apiKey),
        html: validateMrScraperBoolean(params.html, 'HTML') ?? true,
        markdown: validateMrScraperBoolean(params.markdown, 'Markdown') ?? false,
        screenshot,
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
        stream: false,
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
        tokenCap: validateMrScraperInteger(params.tokenCap, 'Token cap', 0),
      }),
  },
  transformResponse: async (response) => {
    const data = requireMrScraperObject(await response.json(), 'page response')
    const error = getMrScraperError(data)
    const statusHeader = response.headers.get('x-status-code')
    const targetStatusCode = statusHeader ? Number(statusHeader) : null
    return {
      success: !error,
      ...(error ? { error } : {}),
      output: {
        html: toStringOrNull(data.html),
        markdown: toStringOrNull(data.markdown),
        screenshot: error ? undefined : getScreenshot(data.screenshot),
        tokenUsage: getMrScraperNumber(data.token_usage),
        runtime: getMrScraperNumber(data.runtime),
        retryCount: getMrScraperNumber(data.retry_count),
        targetStatusCode: getMrScraperNumber(targetStatusCode),
        error,
      },
    }
  },
  outputs: {
    html: { type: 'string', description: 'Page HTML, when requested.', nullable: true },
    markdown: { type: 'string', description: 'Page Markdown, when requested.', nullable: true },
    screenshot: {
      type: 'file',
      description: 'JPEG screenshot stored in execution files.',
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
