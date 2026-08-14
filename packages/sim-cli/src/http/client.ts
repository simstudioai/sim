import type { ResolvedProfile } from '../config/index'

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

/** `{ data, nextCursor }` — one page of a list. */
export interface V2Page<T> {
  data: T[]
  nextCursor: string | null
}

export interface RequestAllPagesOptions extends Omit<RequestOptions, 'query'> {
  query?: Record<string, QueryValue>
  /** Server page size; callers choose one accepted by the endpoint contract. */
  pageSize: number
  /** Maximum items to return. Omit to follow the cursor through the full list. */
  limit?: number
}

export type QueryValue = string | number | boolean | null | undefined
export type AuthRequirement = 'required' | 'optional'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
  /** Contract-declared headers, e.g. the `upload-token` a transfer is bound to. */
  headers?: Record<string, string>
  /** Cancels both the initial request and any subsequent streaming body read. */
  signal?: AbortSignal
  /** Self-hosted, auth-disabled routes may deliberately omit a local API key. */
  auth?: AuthRequirement
}

export interface WorkspaceOptions {
  auth?: AuthRequirement
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

/** Formats nested validation issues as readable, path-aware lines. */
export function formatApiErrorDetails(details: unknown): string[] {
  const issues = new Set<string>()

  const visit = (value: unknown, parentPath: string[] = []): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentPath))
      return
    }
    if (!value || typeof value !== 'object') return

    const issue = value as Record<string, unknown>
    const ownPath = Array.isArray(issue.path) ? issue.path.map(String) : []
    const path = [...parentPath, ...ownPath]
    const nested = Array.isArray(issue.errors) ? issue.errors : []

    if (nested.length > 0) {
      visit(nested, path)
      return
    }
    if (typeof issue.message !== 'string' || issue.message === 'Invalid input') return

    issues.add(`${path.length > 0 ? path.join('.') : 'request'}: ${issue.message}`)
  }

  visit(details)
  if (issues.size === 0) return [`  details: ${truncate(JSON.stringify(details), 1000)}`]

  const visible = [...issues].slice(0, 8)
  const lines = ['  details:', ...visible.map((issue) => `    ${issue}`)]
  if (issues.size > visible.length) lines.push(`    … ${issues.size - visible.length} more issues`)
  return lines
}

export class SimClient {
  constructor(private readonly profile: ResolvedProfile) {}

  private resolveApiKey(auth: AuthRequirement = 'required'): string | undefined {
    if (!this.profile.apiKey) {
      if (auth === 'optional') return undefined
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
   * By default this checks the key first even though it does not need one:
   * commands resolve the workspace while building their query, so without this
   * a brand-new install is told to set a workspace when the actual first step
   * is logging in. Auth-disabled self-hosted protocols opt out explicitly.
   */
  requireWorkspace(explicit?: string, options: WorkspaceOptions = {}): string {
    this.resolveApiKey(options.auth)
    const workspaceId = explicit ?? this.profile.workspaceId
    if (!workspaceId) {
      throw new SimApiError(
        `No workspace set for profile "${this.profile.name}". Pass --workspace, or run: sim configure --profile ${this.profile.name} --set-workspace <id>`,
        0
      )
    }
    return workspaceId
  }

  /**
   * Makes a request without consuming its body. Authentication is required
   * unless a self-hosted protocol explicitly opts out.
   *
   * JSON commands use {@link request}; streaming and binary protocols keep the
   * raw response so they can process bytes incrementally. HTTP failures still
   * become the same structured `SimApiError` either way.
   */
  async requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    const apiKey = this.resolveApiKey(options.auth)

    const url = buildUrl(this.profile.endpoint, path, options.query)
    const hasBody = options.body !== undefined

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          accept: 'application/json',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      })
    } catch (cause) {
      if (options.signal?.aborted) {
        throw new SimApiError('Request cancelled.', 0)
      }
      throw new SimApiError(
        `Could not reach ${this.profile.endpoint}: ${(cause as Error).message}`,
        0
      )
    }

    if (!response.ok) {
      const raw = await response.text()
      const error = toApiError(response.status, raw)
      if (response.status === 401) {
        error.message = `${error.message} — run: sim login --profile ${this.profile.name}`
      }
      throw error
    }

    return response
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.requestRaw(path, options)
    const raw = await response.text()

    if (!raw) return undefined as T
    return JSON.parse(raw) as T
  }
}

/** Follows a standard v2 cursor envelope without duplicating pagination loops. */
export async function requestAllPages<T>(
  client: Pick<SimClient, 'request'>,
  path: string,
  options: RequestAllPagesOptions
): Promise<T[]> {
  const { query, pageSize, limit: requestedLimit, ...requestOptions } = options
  const limit = requestedLimit ?? Number.POSITIVE_INFINITY
  if (limit <= 0) return []

  const items: T[] = []
  let cursor: string | null = null
  do {
    const page: V2Page<T> = await client.request<V2Page<T>>(path, {
      ...requestOptions,
      query: {
        ...query,
        limit: Math.min(pageSize, limit - items.length),
        cursor,
      },
    })
    items.push(...page.data)
    cursor = page.nextCursor
  } while (cursor && items.length < limit)

  return items.slice(0, limit)
}

/**
 * Substitutes `[id]`-style path segments.
 *
 * Values are percent-encoded: table and workspace ids are opaque, and a `/` or
 * `?` inside one would otherwise silently retarget the request at a different
 * endpoint.
 */
export function resolvePath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\[([^\]]+)\]/g, (_match, key: string) => {
    const value = params[key]
    if (value === undefined) {
      throw new SimApiError(`Missing path parameter "${key}" for ${template}`, 0)
    }
    return encodeURIComponent(value)
  })
}
