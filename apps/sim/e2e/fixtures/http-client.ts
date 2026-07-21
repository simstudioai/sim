import { sleep } from '@sim/utils/helpers'
import type { z } from 'zod'

// Better Auth does not emit Retry-After for every limiter. The bounded fallback spans its
// one-minute signup window while still preferring an explicit server header when available.
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const
const MAX_RETRY_DELAY_MS = 30_000
const MAX_TOTAL_RETRY_DELAY_MS = 90_000

export interface E2eHttpClientOptions {
  baseUrl: string
  defaultHeaders?: Record<string, string>
  fetchImplementation?: typeof fetch
  sleepImplementation?: (milliseconds: number) => Promise<void>
  retryDelaysMs?: readonly number[]
  onAttempt?: (attempt: { method: string; path: string; number: number; status?: number }) => void
}

export class E2eHttpClient {
  private readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string>
  private readonly fetchImplementation: typeof fetch
  private readonly sleepImplementation: (milliseconds: number) => Promise<void>
  private readonly retryDelaysMs: readonly number[]
  private readonly onAttempt?: E2eHttpClientOptions['onAttempt']
  private readonly cookies = new Map<string, string>()

  constructor(options: E2eHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.defaultHeaders = options.defaultHeaders ?? {}
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.sleepImplementation = options.sleepImplementation ?? sleep
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    this.onAttempt = options.onAttempt
  }

  async request<TSchema extends z.ZodType>(options: {
    method?: string
    path: string
    body?: unknown
    schema: TSchema
    expectedStatus?: number | readonly number[]
  }): Promise<z.infer<TSchema>> {
    const method = options.method ?? 'GET'
    const expectedStatuses = Array.isArray(options.expectedStatus)
      ? options.expectedStatus
      : [options.expectedStatus ?? 200]
    let totalRetryDelay = 0

    for (let attempt = 1; ; attempt += 1) {
      const response = await this.fetchImplementation(`${this.baseUrl}${options.path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...this.defaultHeaders,
          ...(this.cookies.size > 0 ? { cookie: this.serializeCookies() } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
      })
      this.captureCookies(response.headers)
      this.onAttempt?.({ method, path: options.path, number: attempt, status: response.status })

      if (response.status === 429 && attempt <= this.retryDelaysMs.length) {
        const requestedDelay =
          parseRetryAfter(response.headers.get('retry-after')) ?? this.retryDelaysMs[attempt - 1]
        const remainingDelayBudget = MAX_TOTAL_RETRY_DELAY_MS - totalRetryDelay
        if (remainingDelayBudget > 0) {
          const delay = Math.min(requestedDelay, MAX_RETRY_DELAY_MS, remainingDelayBudget)
          totalRetryDelay += delay
          await this.sleepImplementation(delay)
          continue
        }
      }

      const payload = await readJsonResponse(response, method, options.path)
      if (!expectedStatuses.includes(response.status)) {
        throw new Error(
          `${method} ${options.path} returned ${response.status}; expected ${expectedStatuses.join(
            '/'
          )}; response body redacted`
        )
      }
      const parsed = options.schema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(
          `${method} ${options.path} returned an invalid response: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ')}`
        )
      }
      return parsed.data
    }
  }

  getCookieHeader(): string {
    return this.serializeCookies()
  }

  clearCookies(): void {
    this.cookies.clear()
  }

  private captureCookies(headers: Headers): void {
    const values =
      'getSetCookie' in headers && typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : splitCombinedSetCookie(headers.get('set-cookie'))
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const cookieValue = pair.slice(separator + 1).trim()
      if (cookieValue) this.cookies.set(name, cookieValue)
      else this.cookies.delete(name)
    }
  }

  private serializeCookies(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

function splitCombinedSetCookie(value: string | null): string[] {
  if (!value) return []
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/)
}

async function readJsonResponse(
  response: Response,
  method: string,
  path: string
): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${method} ${path} returned non-JSON content with status ${response.status}`)
  }
}
