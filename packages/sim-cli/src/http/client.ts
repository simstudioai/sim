import chalk from 'chalk'
import type { ResolvedProfile, StoredCredential, StoredOAuthCredential } from '../config/index'
import { USER_AGENT } from '../version'
import { warnIfCredentialOverCleartext, warnIfProxyIgnored } from './environment'

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

/**
 * Joins an endpoint and a route into a request URL.
 *
 * Concatenation rather than `new URL(path, endpoint)`, which is the trap it
 * exists to avoid: a leading-slash path is absolute, so `new URL()` resolves it
 * against the endpoint's ORIGIN and silently drops any path the endpoint
 * carries. A deployment served under a prefix — `https://host/sim` behind a
 * proxy that fronts several apps — would have every request rewritten to
 * `https://host/...`, losing the prefix that identifies it.
 *
 * Empty values are skipped rather than sent blank so an omitted optional
 * parameter reads as absent, not as the empty string.
 */
export function buildUrl(
  endpoint: string,
  path: string,
  query?: Record<string, QueryValue>
): string {
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

/**
 * The 403 causes the CLI can turn into an instruction.
 *
 * Two codes describe the same refusal because they are raised at different
 * layers: the workspace-key policy answers `WORKSPACE_KEY_OPERATION_NOT_PERMITTED`,
 * while the principal-kind check answers `PRINCIPAL_KIND_NOT_PERMITTED` with a
 * message written for a server log ("Principal kind workspace_api_key cannot
 * perform operation audit_logs.list"). Recognising only the first left the
 * audit-log commands stating the refusal in vocabulary the reader has no way to
 * act on, and without the one sentence that resolves it.
 */
const KEY_SCOPE_REFUSALS = new Set([
  'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
  'PRINCIPAL_KIND_NOT_PERMITTED',
])

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
 * Keeps the useful nested reason from Node/Undici transport failures without
 * serializing request options, headers, socket objects, or credentials.
 */
function transportErrorMessage(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<object>()
  let current: unknown = error

  while (current && typeof current === 'object' && messages.length < 4 && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { message?: unknown; code?: unknown; cause?: unknown }
    const message =
      typeof candidate.message === 'string'
        ? truncate(candidate.message.replace(/\s+/g, ' ').trim(), 300)
        : ''
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    const detail = `${message}${code && !message.includes(code) ? ` (${code})` : ''}`
    if (detail && messages.at(-1) !== detail) messages.push(detail)
    current = candidate.cause
  }

  return messages.join(': ') || 'Unknown network error'
}

/**
 * Whether this is the refusal a workspace-scoped key gets from an operation only
 * a personal key may perform, under either code that expresses it.
 *
 * `error.code` is the envelope's status class and is plain `FORBIDDEN` here; the
 * actionable code rides in `error.details.code`, which is where the v2 error
 * projection puts a refusal that names its cause. Reading only the top-level
 * code meant the remedy was never appended against the real API. The top level
 * is still accepted so a server that promotes the code stays covered.
 */
function namesKeyScopeRefusal(error: SimApiError): boolean {
  if (typeof error.code === 'string' && KEY_SCOPE_REFUSALS.has(error.code)) return true
  const details = error.details
  if (!details || typeof details !== 'object') return false
  const code = (details as { code?: unknown }).code
  return typeof code === 'string' && KEY_SCOPE_REFUSALS.has(code)
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

/**
 * How long a single request may take before the CLI gives up, in seconds.
 *
 * The default is deliberately above every bound the server itself applies: a
 * synchronous workflow run is allowed 3000s on a paid plan, so a tighter
 * default would abort real work and report it as a transport failure. What it
 * catches is the case the server cannot — a connection that is accepted and
 * then never answers, which otherwise hangs the terminal indefinitely.
 *
 * `SIM_TIMEOUT_SECONDS=0` removes the bound, for a self-hosted deployment that
 * runs executions without one of its own.
 */
const DEFAULT_TIMEOUT_SECONDS = 3600

/**
 * The longest delay Node's timers accept.
 *
 * Past it a timeout does not fail — it silently becomes 1ms, so the request the
 * caller asked to wait longest for would be the first one aborted.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** The one instruction that resolves an elapsed request bound, wherever it surfaces. */
export const RAISE_TIMEOUT_HINT = 'Raise SIM_TIMEOUT_SECONDS, or set it to 0 to wait indefinitely.'

/**
 * Whether this is the CLI's own request bound elapsing.
 *
 * `AbortSignal.timeout` raises `TimeoutError`, while a caller's cancel raises
 * `AbortError` — so this distinguishes a bound the user can raise from a stop
 * the user asked for, which must keep reading as a cancellation.
 */
export function isRequestTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIM_TIMEOUT_SECONDS
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_SECONDS * 1000

  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new SimApiError(
      `Invalid SIM_TIMEOUT_SECONDS "${raw}". Use a non-negative number of seconds, or 0 to disable.`,
      0
    )
  }

  // Rounded because a fractional millisecond is rejected outright by
  // `AbortSignal.timeout`, and a sub-millisecond timeout is not a distinction
  // anyone is drawing. Floored at 1ms for anything above zero: rounding alone
  // sent a bound under 0.0005s to 0, which this function reserves for "no
  // bound at all", so asking for the shortest possible timeout produced none.
  const ms = seconds === 0 ? 0 : Math.max(1, Math.round(seconds * 1000))
  if (ms > MAX_TIMEOUT_MS) {
    throw new SimApiError(
      `SIM_TIMEOUT_SECONDS "${raw}" is longer than Node can wait (${Math.floor(MAX_TIMEOUT_MS / 1000)}s). Use 0 to wait indefinitely.`,
      0
    )
  }
  return ms
}

/**
 * Aborts when either signal does.
 *
 * `AbortSignal.any` arrived in Node 20.3 and this package supports Node 20, so
 * on the earliest 20.x releases calling it would throw a bare `TypeError`
 * before the request was ever made — turning a supported runtime into a crash.
 */
function combineSignals(
  caller: AbortSignal | undefined,
  timeout: AbortSignal | undefined
): AbortSignal | undefined {
  if (!caller) return timeout
  if (!timeout) return caller
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([caller, timeout])

  const controller = new AbortController()
  for (const signal of [caller, timeout]) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/** Whether to trace requests to stderr. */
function debugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SIM_DEBUG
  return raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false'
}

/**
 * Traces one request on stderr.
 *
 * Method, URL, status and duration only. Bodies and headers are deliberately
 * absent: the request carries the API key, and `secrets set` carries the secret
 * itself, so a trace that included either would write credentials into whatever
 * log the user pasted it into.
 */
function traceRequest(method: string, url: string, status: number | string, startedAt: number) {
  process.stderr.write(
    `${chalk.dim(`[sim] ${method} ${url} → ${status} ${Math.round(performance.now() - startedAt)}ms`)}\n`
  )
}

/**
 * Drops a label the message already opens with.
 *
 * Some routes name the field inside the message as well as in `path`, and the
 * two are printed one after the other: `sortBy: only \"startedAt\" can order job
 * runs` under `path: ['sortBy']` came out as `--sort-by: --sort-by: only …`
 * once the wire name had been retyped as the flag.
 */
function withoutLeadingLabel(message: string, label: string): string {
  const prefix = `${label}: `
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
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
    ...visible.map((issue) => {
      const label = issue.path.length > 0 ? issue.path.join('.') : 'request'
      return `    ${label}: ${withoutLeadingLabel(issue.message, label)}`
    }),
  ]
  if (kept.length > visible.length) lines.push(`    … ${kept.length - visible.length} more issues`)
  return lines
}

/**
 * Renews an OAuth login and returns the new pair; injected so the HTTP client
 * does not import the OAuth flow, which imports the client.
 */
export type OAuthRefresher = (
  profile: ResolvedProfile,
  current: StoredOAuthCredential
) => Promise<StoredOAuthCredential>

export interface SimClientOptions {
  refreshOAuth?: OAuthRefresher
}

/**
 * Renew this long before the access token lapses. A request that starts with
 * a few seconds left can still land after expiry; five minutes is the margin
 * the AWS CLI and WorkOS's guidance settle on, and well inside the hour a Sim
 * access token lives.
 */
const REFRESH_AHEAD_MS = 5 * 60 * 1000

/** Reads the OAuth error parameter from Sim's Bearer challenge. */
function bearerChallengeError(header: string | null): string | null {
  if (!header?.trimStart().toLowerCase().startsWith('bearer')) return null
  const match = /(?:^|,)\s*error\s*=\s*(?:"([^"]*)"|([^,\s]+))/i.exec(
    header.replace(/^\s*Bearer\s*/i, '')
  )
  return match?.[1] ?? match?.[2] ?? null
}

export class SimClient {
  private oauth: StoredOAuthCredential | null
  private refreshing: Promise<StoredOAuthCredential> | null = null

  constructor(
    private readonly profile: ResolvedProfile,
    private readonly options: SimClientOptions = {}
  ) {
    this.oauth = profile.oauth ?? null
  }

  private resolveCredential(auth: AuthRequirement = 'required'): StoredCredential | undefined {
    if (this.profile.apiKey) return { kind: 'api_key', apiKey: this.profile.apiKey }
    if (this.oauth) return { kind: 'oauth', oauth: this.oauth }
    if (auth === 'optional') return undefined
    throw new SimApiError(
      `Not logged in on profile "${this.profile.name}". Run: sim login --profile ${this.profile.authProfile}`,
      0
    )
  }

  /**
   * One refresh at a time per process, shared by every request that finds the
   * token expiring; the cross-process half lives behind the refresher.
   */
  private async refreshOAuth(current: StoredOAuthCredential): Promise<StoredOAuthCredential> {
    const refresh = this.options.refreshOAuth
    if (!refresh) {
      throw new SimApiError(
        `Your Sim login has expired. Run sim logout --profile ${this.profile.name}, then sim login --profile ${this.profile.name}.`,
        401
      )
    }
    if (!this.refreshing) {
      this.refreshing = refresh(this.profile, current).finally(() => {
        this.refreshing = null
      })
    }
    const next = await this.refreshing
    this.oauth = next
    return next
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
    this.resolveCredential(options.auth)
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
    options: RequestOptions,
    retriedAfterRefresh = false
  ): Promise<{ response: Response; url: string }> {
    let credential = this.resolveCredential(options.auth)
    if (
      credential?.kind === 'oauth' &&
      credential.oauth.expiresAt - Date.now() < REFRESH_AHEAD_MS
    ) {
      credential = { kind: 'oauth', oauth: await this.refreshOAuth(credential.oauth) }
    }

    const url = buildUrl(this.profile.endpoint, path, options.query)
    const hasBody = options.body !== undefined
    const method = options.method ?? 'GET'

    warnIfProxyIgnored()
    warnIfCredentialOverCleartext(this.profile.endpoint, Boolean(credential))

    // The caller's signal still cancels; the timeout only adds a second reason
    // to abort, so neither can mask the other.
    const timeoutMs = resolveTimeoutMs()
    const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
    const signal = combineSignals(options.signal, timeout)

    const trace = debugEnabled()
    const startedAt = performance.now()

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...(credential?.kind === 'api_key' ? { 'x-api-key': credential.apiKey } : {}),
          ...(credential?.kind === 'oauth'
            ? { authorization: `Bearer ${credential.oauth.accessToken}` }
            : {}),
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal,
        redirect: 'manual',
      })
    } catch (cause) {
      if (trace) traceRequest(method, url, 'failed', startedAt)
      if (options.signal?.aborted) {
        throw new SimApiError('Request cancelled.', 0)
      }
      if (timeout?.aborted) {
        throw new SimApiError(
          `${url} did not answer within ${timeoutMs / 1000}s. ${RAISE_TIMEOUT_HINT}`,
          0
        )
      }
      throw new SimApiError(
        `Could not reach ${this.profile.endpoint}: ${transportErrorMessage(cause)}`,
        0
      )
    }

    if (trace) traceRequest(method, url, response.status, startedAt)

    if (REDIRECT_STATUSES.has(response.status)) throw this.toRedirectError(url, path, response)

    /**
     * A token the server no longer accepts — revoked, or expired on a clock
     * this process disagrees with — is renewed once and the request repeated.
     * Only for `invalid_token` (RFC 6750 §3.1): any other 401 means the
     * refresh would not change the answer.
     */
    if (
      response.status === 401 &&
      credential?.kind === 'oauth' &&
      !retriedAfterRefresh &&
      bearerChallengeError(response.headers.get('www-authenticate')) === 'invalid_token'
    ) {
      await response.body?.cancel()
      await this.refreshOAuth(credential.oauth)
      return this.send(path, options, true)
    }

    if (!response.ok) {
      const raw = await response.text()
      const error = toApiError(url, response.status, response.headers.get('content-type'), raw)
      if (response.status === 401) {
        error.message = `${error.message} — run: sim login --profile ${this.profile.authProfile}`
      }
      if (namesKeyScopeRefusal(error)) {
        error.message = `${error.message} — this operation does not support workspace API keys; use an OAuth login or personal API key: sim login --profile ${this.profile.authProfile}`
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
  private toRedirectError(url: string, path: string, response: Response): SimApiError {
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
    const suggested = redirectEndpoint(this.profile.endpoint, path, target)
    if (!suggested) {
      return new SimApiError(
        `${url} redirected to ${target.href}. The CLI does not follow redirects, because a redirect can drop the request body and turn a write into a silent no-op.`,
        response.status
      )
    }
    return new SimApiError(
      `Endpoint redirected to ${suggested}. Run: sim configure --profile ${this.profile.name} --set-endpoint ${suggested}`,
      response.status
    )
  }
}

/**
 * The endpoint a redirect implies, or null when it implies no change.
 *
 * Strips the request's own path from the target rather than taking
 * `target.origin`, so a self-hosted endpoint carrying a path prefix
 * (`https://host/sim`) keeps it. Naming the bare origin would hand back a value
 * that is not an API root, and following that advice would break a deployment
 * that was only ever one hostname away from working.
 *
 * Null when the target resolves to the endpoint already configured — a
 * trailing-slash or path-normalization redirect keeps the origin, and telling
 * someone to set the value they already have explains nothing.
 */
export function redirectEndpoint(
  endpoint: string,
  requestPath: string,
  target: URL
): string | null {
  const prefix = target.pathname.endsWith(requestPath)
    ? target.pathname.slice(0, target.pathname.length - requestPath.length)
    : ''
  const suggested = `${target.origin}${prefix}`.replace(/\/+$/, '')
  return suggested === endpoint.replace(/\/+$/, '') ? null : suggested
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
  return (await requestPages<T>(client, path, options)).items
}

/**
 * The same walk, also stating whether it stopped short.
 *
 * A caller that prints the rows itself has to say so — `files list` announces
 * "showing the first N" off the surviving cursor and `files ls` did not, so the
 * same capped answer looked complete on one command and incomplete on its
 * neighbour.
 */
export async function requestPages<T>(
  client: Pick<SimClient, 'request'>,
  path: string,
  options: RequestAllPagesOptions
): Promise<{ items: T[]; truncated: boolean }> {
  const { query, pageSize, limit: requestedLimit, ...requestOptions } = options
  const limit = requestedLimit ?? Number.POSITIVE_INFINITY
  if (limit <= 0) return { items: [], truncated: false }

  const items: T[] = []
  const progress = pageProgress()
  let cursor: string | null = null
  // `finally`, because a page that throws part-way through would otherwise skip
  // the cleanup and leave `fetched 1200…` sitting on the line the error is then
  // written onto.
  try {
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
  } finally {
    progress.finish()
  }

  return { items: items.slice(0, limit), truncated: cursor !== null || items.length > limit }
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
