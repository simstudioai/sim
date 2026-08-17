import chalk from 'chalk'
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
 * Statuses `fetch` would otherwise follow for us, and must not.
 *
 * A 301/302/303 is rewritten to a bodyless GET per the Fetch spec, so an
 * endpoint that redirects (an apex host pointing at `www.`, say) keeps every
 * read working through its query string while every write silently arrives with
 * no body — the endpoint looks correct and only writes fail. Following a
 * redirect would also hand the API key to whatever origin `Location` names.
 */
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Markup a JSON endpoint would never answer with — a proxy or landing page. */
const MARKUP_PREFIX = /^\s*<(?:!doctype|html|\?xml)/i

/** The one 403 cause the CLI can turn into an instruction. */
const WORKSPACE_KEY_REFUSAL = 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED'

/**
 * Names the response the server actually sent, for a body that is not JSON.
 *
 * Dumping the body as the message turns a wrong endpoint into a wall of HTML
 * that says nothing about what went wrong, so the URL and the shape lead; a
 * short plain-text body (a proxy's `Bad Gateway`) is the diagnosis itself and is
 * kept, while markup is not.
 */
function toNonJsonError(
  url: string,
  status: number,
  contentType: string | null,
  raw: string
): SimApiError {
  const type = contentType?.split(';')[0]?.trim().toLowerCase()
  const isMarkup =
    type === 'text/html' || type === 'application/xhtml+xml' || MARKUP_PREFIX.test(raw)
  const kind = isMarkup
    ? 'HTML'
    : type && type !== 'application/json'
      ? type
      : 'a non-JSON response'

  const text = raw.trim()
  const keepSnippet = !isMarkup && text.length > 0 && text.length <= 200
  return new SimApiError(
    `${url} returned ${kind}, not JSON (HTTP ${status}) — check your endpoint.${
      keepSnippet ? ` Response: ${truncate(text, 200)}` : ''
    }`,
    status
  )
}

/**
 * Pulls a human-readable message out of whatever the server returned.
 *
 * v2 answers with `{ error: { code, message } }`, but a request can also be
 * turned away before it reaches a v2 route — by the v1 auth middleware
 * (`{ error }`), or by a proxy that returns HTML. Each of those still has to
 * produce a sentence rather than `[object Object]`.
 */
function toApiError(
  url: string,
  status: number,
  contentType: string | null,
  raw: string
): SimApiError {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    if (!raw.trim()) return new SimApiError(`Request failed with status ${status}`, status)
    return toNonJsonError(url, status, contentType, raw)
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

/**
 * The refusal a workspace-scoped key gets from an operation only a personal key
 * may perform.
 *
 * `error.code` is the envelope's status class and is plain `FORBIDDEN` here; the
 * actionable code rides in `error.details.code`, which is where the v2 error
 * projection puts a refusal that names its cause. Reading only the top-level
 * code meant the remedy was never appended against the real API. The top level
 * is still accepted so a server that promotes the code stays covered.
 */
function namesWorkspaceKeyRefusal(error: SimApiError): boolean {
  if (error.code === WORKSPACE_KEY_REFUSAL) return true
  const details = error.details
  if (!details || typeof details !== 'object') return false
  return (details as { code?: unknown }).code === WORKSPACE_KEY_REFUSAL
}

interface DetailIssue {
  path: string[]
  message: string
  /** The keys an `unrecognized_keys` issue names, `null` on every other issue. */
  unrecognizedKeys: string[] | null
}

/** True when `path` addresses a strict ancestor of `other`. */
function isStrictPrefix(path: string[], other: string[]): boolean {
  if (path.length >= other.length) return false
  return path.every((segment, index) => segment === other[index])
}

/**
 * True when `issue` rejects a key that another issue was found *underneath*.
 *
 * That combination only happens on a union: Zod reports every branch, so one bad
 * operator arrives as both the real complaint (`predicate.all.0.op: invalid
 * option`) and the branch with no `all` key at all (`predicate: unrecognized key
 * "all"` — flatly untrue where the input landed). A genuinely unrecognized key
 * is a key the schema knows nothing about, so no other issue can be reported
 * inside it.
 */
function rejectsAKeyThatValidated(issue: DetailIssue, other: DetailIssue): boolean {
  if (!issue.unrecognizedKeys || !isStrictPrefix(issue.path, other.path)) return false
  return issue.unrecognizedKeys.includes(other.path[issue.path.length])
}

/**
 * Drops the "unrecognized key" a union reports about the branch the input did
 * not take.
 *
 * Scoped to that one shape on purpose. Suppressing every ancestor path instead
 * swallowed complaints the caller has to act on and cannot see anywhere else: a
 * container-level cap (`orderKeys: too big` alongside a bad element) and a
 * cross-field refusal, whose path is empty and so is an ancestor of everything.
 */
function dropUnionBranchNoise(issues: DetailIssue[]): DetailIssue[] {
  if (issues.length < 2) return issues
  const kept = issues.filter(
    (issue) => !issues.some((other) => rejectsAKeyThatValidated(issue, other))
  )
  return kept.length > 0 ? kept : issues
}

/** Formats nested validation issues as readable, path-aware lines. */
export function formatApiErrorDetails(details: unknown): string[] {
  const issues: DetailIssue[] = []
  const seen = new Set<string>()

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

    const line = `${path.join('.')}: ${issue.message}`
    if (seen.has(line)) return
    seen.add(line)
    issues.push({
      path,
      message: issue.message,
      unrecognizedKeys:
        issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)
          ? issue.keys.map(String)
          : null,
    })
  }

  visit(details)
  if (issues.length === 0) return [`  details: ${truncate(JSON.stringify(details), 1000)}`]

  const kept = dropUnionBranchNoise(issues)
  const visible = kept.slice(0, 8)
  const lines = [
    '  details:',
    ...visible.map(
      (issue) => `    ${issue.path.length > 0 ? issue.path.join('.') : 'request'}: ${issue.message}`
    ),
  ]
  if (kept.length > visible.length) lines.push(`    … ${kept.length - visible.length} more issues`)
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
    return (await this.send(path, options)).response
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { response, url } = await this.send(path, options)
    const raw = await response.text()

    if (!raw) return undefined as T
    try {
      return JSON.parse(raw) as T
    } catch {
      throw toNonJsonError(url, response.status, response.headers.get('content-type'), raw)
    }
  }

  private async send(
    path: string,
    options: RequestOptions
  ): Promise<{ response: Response; url: string }> {
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
        redirect: 'manual',
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

    if (REDIRECT_STATUSES.has(response.status)) throw this.toRedirectError(url, response)

    if (!response.ok) {
      const raw = await response.text()
      const error = toApiError(url, response.status, response.headers.get('content-type'), raw)
      if (response.status === 401) {
        error.message = `${error.message} — run: sim login --profile ${this.profile.name}`
      }
      if (namesWorkspaceKeyRefusal(error)) {
        error.message = `${error.message} — this operation needs a personal API key: sim login --profile ${this.profile.name}`
      }
      throw error
    }

    return { response, url }
  }

  /**
   * Explains a redirect instead of following it, naming the endpoint to switch to.
   *
   * The destination comes from `Location` resolved against the request URL, so a
   * relative target works and no string surgery is done on the configured
   * endpoint. A `Location` that is missing or unparseable still has to produce a
   * sentence — the redirect is the finding either way.
   */
  private toRedirectError(url: string, response: Response): SimApiError {
    const location = response.headers.get('location')?.trim()
    let target: URL | null = null
    if (location) {
      try {
        target = new URL(location, url)
      } catch {
        target = null
      }
    }

    if (!target) {
      return new SimApiError(
        `${url} answered HTTP ${response.status} with no usable redirect target. Check the endpoint for profile "${this.profile.name}".`,
        response.status
      )
    }
    if (target.origin === new URL(url).origin) {
      return new SimApiError(
        `${url} redirected to ${target.href}. The CLI does not follow redirects, because a redirect can drop the request body and turn a write into a silent no-op.`,
        response.status
      )
    }
    return new SimApiError(
      `Endpoint redirected to ${target.origin}. Run: sim configure --profile ${this.profile.name} --set-endpoint ${target.origin}`,
      response.status
    )
  }
}

export interface PageProgress {
  /** Call once a further page is known to be coming, with the count so far. */
  advance: (fetched: number) => void
  /** Erases the line, if anything was ever written to it. */
  finish: () => void
}

/**
 * Reports cursor progress on stderr while a list keeps paging.
 *
 * A long cursor is many sequential requests and reads as a hang, so say so — but
 * only on a terminal, and only on stderr, because stdout is what gets piped to
 * `jq`.
 *
 * Shared because the CLI pages in two places: {@link requestAllPages} for the
 * `ls` commands, and the contract-driven loop in `runtime/execute`, which also
 * has to carry a cursor in the body. Only one of them had the writer, and it was
 * not the one nearly every `list --limit 0` goes through.
 */
export function pageProgress(): PageProgress {
  let reported = false
  return {
    advance: (fetched) => {
      if (!process.stderr.isTTY) return
      reported = true
      process.stderr.write(`\r${chalk.dim(`fetched ${fetched}…`)}\u001b[K`)
    },
    finish: () => {
      if (reported) process.stderr.write('\r\u001b[K')
    },
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
  const progress = pageProgress()
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

    if (cursor && items.length < limit) progress.advance(items.length)
  } while (cursor && items.length < limit)

  progress.finish()

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
