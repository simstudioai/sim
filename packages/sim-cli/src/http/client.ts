import type { ResolvedProfile } from '../config/index.js'

/**
 * A failure the CLI can explain. Anything thrown as a `SimApiError` is printed
 * as a clean message and a non-zero exit; anything else escapes as a stack
 * trace, which is the signal that the CLI itself is broken rather than the
 * request.
 */
export class SimApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'SimApiError'
  }
}

/** `{ data }` — a single resource. */
interface V2DataEnvelope<T> {
  data: T
}

/** `{ data, nextCursor }` — one page of a list. */
export interface V2Page<T> {
  data: T[]
  nextCursor: string | null
}

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
}

function buildUrl(endpoint: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${endpoint}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Pulls a human-readable message out of whatever the server returned.
 *
 * v2 answers with `{ error: { code, message } }`, but a request can also be
 * turned away before it reaches a v2 route — by the v1 auth middleware
 * (`{ error }`), or by a proxy that returns HTML. Each of those still has to
 * produce a sentence rather than `[object Object]`.
 */
function toApiError(status: number, raw: string): SimApiError {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const text = raw.trim()
    return new SimApiError(
      text ? truncate(text, 300) : `Request failed with status ${status}`,
      status
    )
  }

  const body = parsed as { error?: unknown; message?: unknown }

  if (body.error && typeof body.error === 'object') {
    const error = body.error as { code?: unknown; message?: unknown; details?: unknown }
    return new SimApiError(
      typeof error.message === 'string' ? error.message : `Request failed with status ${status}`,
      status,
      typeof error.code === 'string' ? error.code : null,
      error.details
    )
  }

  if (typeof body.error === 'string') return new SimApiError(body.error, status)
  if (typeof body.message === 'string') return new SimApiError(body.message, status)

  return new SimApiError(`Request failed with status ${status}`, status)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

export class SimClient {
  constructor(private readonly profile: ResolvedProfile) {}

  private requireAuth(): string {
    if (!this.profile.apiKey) {
      throw new SimApiError(
        `Not logged in on profile "${this.profile.name}". Run: sim login --profile ${this.profile.name}`,
        0
      )
    }
    return this.profile.apiKey
  }

  /**
   * The workspace every workspace-scoped command defaults to.
   *
   * Checks the key first even though it does not need one: commands resolve the
   * workspace while building their query, so without this a brand-new install
   * is told to set a workspace when the actual first step is logging in.
   */
  requireWorkspace(explicit?: string): string {
    this.requireAuth()
    const workspaceId = explicit ?? this.profile.workspaceId
    if (!workspaceId) {
      throw new SimApiError(
        `No workspace set for profile "${this.profile.name}". Pass --workspace, or run: sim configure --profile ${this.profile.name} --set-workspace <id>`,
        0
      )
    }
    return workspaceId
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const apiKey = this.requireAuth()

    const url = buildUrl(this.profile.endpoint, path, options.query)
    const hasBody = options.body !== undefined

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
      })
    } catch (cause) {
      throw new SimApiError(
        `Could not reach ${this.profile.endpoint}: ${(cause as Error).message}`,
        0
      )
    }

    const raw = await response.text()

    if (!response.ok) {
      const error = toApiError(response.status, raw)
      if (response.status === 401) {
        error.message = `${error.message} — run: sim login --profile ${this.profile.name}`
      }
      throw error
    }

    if (!raw) return undefined as T
    return JSON.parse(raw) as T
  }

  /** Unwraps `{ data }`. */
  async getData<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const body = await this.request<V2DataEnvelope<T>>(path, options)
    return body.data
  }

  /** One page of `{ data, nextCursor }`. */
  async getPage<T>(path: string, options: RequestOptions = {}): Promise<V2Page<T>> {
    return this.request<V2Page<T>>(path, options)
  }

  /**
   * Walks a cursor list until it is exhausted or `max` items are collected.
   *
   * `max` is required rather than optional: an unbounded auto-pager against a
   * workspace with a million logs will happily fill memory and hammer the rate
   * limiter, so the caller always states a ceiling.
   */
  async collect<T>(path: string, options: RequestOptions, max: number): Promise<T[]> {
    const items: T[] = []
    let cursor: string | null = null

    do {
      const page: V2Page<T> = await this.getPage<T>(path, {
        ...options,
        query: { ...options.query, cursor },
      })
      items.push(...page.data)
      cursor = page.nextCursor
    } while (cursor && items.length < max)

    return items.slice(0, max)
  }
}
