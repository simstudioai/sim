import dns from 'node:dns/promises'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'
import http from 'http'
import https from 'https'
import type { LookupFunction } from 'net'
import { createLogger } from '@sim/logger'
import { preferIpv4, resolveHostAddresses } from '@sim/security/dns'
import type { EgressDecision } from '@sim/security/egress'
import { isIpLiteral, unwrapIpv6Brackets } from '@sim/security/ssrf'
import { toError } from '@sim/utils/errors'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  Agent,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
  request as undiciRequest,
} from 'undici'
import { describeEgressDenial, type EgressProfile } from '@/lib/core/security/egress/profiles'
import {
  checkEgressUrl,
  checkResolvedEgress,
  validateEgressUrl,
} from '@/lib/core/security/egress/validate'
import type { HttpRedirectPolicy } from '@/lib/core/security/http-redirect-policy'
import type { ValidationResult } from '@/lib/core/security/input-validation'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const logger = createLogger('InputValidation')

/**
 * Result type for async URL validation with resolved IP
 */
export type AsyncValidationResult =
  | { isValid: true; resolvedIP: string; originalHostname: string; error?: undefined }
  | { isValid: false; error: string; resolvedIP?: undefined; originalHostname?: undefined }

/**
 * Validates a URL, resolves its DNS, and returns the address to pin.
 *
 * `profile` states where the URL came from — see {@link EgressProfile}. It is
 * required because provenance is the only input to the trust decision, and a
 * wrong guess is silent in both directions: too strict breaks a self-hosted
 * integration, too loose hands an attacker the internal network.
 *
 * @param url - The URL to validate
 * @param paramName - Name of the parameter for error messages
 * @param profile - Where this URL came from
 * @returns AsyncValidationResult with resolved IP for DNS pinning
 */
export async function validateUrlWithDNS(
  url: string | null | undefined,
  paramName: string,
  profile: EgressProfile
): Promise<AsyncValidationResult> {
  const result = await validateEgressUrl(url, paramName, profile)
  return result.isValid
    ? { isValid: true, resolvedIP: result.resolvedIP, originalHostname: result.originalHostname }
    : { isValid: false, error: result.error }
}

/**
 * Result of validating a user-supplied HTTP proxy URL.
 */
export interface ProxyValidationResult {
  isValid: boolean
  /** Proxy URL with hostname rewritten to the resolved IP (creds/port preserved) to pin the proxy connection. */
  pinnedProxyUrl?: string
  error?: string
}

/**
 * Validates a user-supplied HTTP proxy URL and returns an IP-pinned form.
 *
 * When a request routes through a proxy, the TCP connection targets the proxy
 * host (the proxy resolves the destination), so target-IP pinning no longer
 * governs egress and the proxy URL becomes the SSRF surface. This function:
 * 1. Enforces the `http:` scheme (raw TCP to the proxy, no TLS-to-proxy SNI to
 *    reconcile, so the host can be safely rewritten to an IP).
 * 2. Resolves the proxy host's DNS and blocks private/reserved/loopback IPs via
 *    {@link validateUrlWithDNS}.
 * 3. Pins the connection by rewriting the hostname to the resolved IP while
 *    preserving credentials/port, closing the DNS-rebinding (TOCTOU) window.
 *
 * @param proxyUrl - The proxy URL (e.g. `http://user:pass@host:port`)
 */
export async function validateAndPinProxyUrl(
  proxyUrl: string | null | undefined
): Promise<ProxyValidationResult> {
  if (!proxyUrl || typeof proxyUrl !== 'string') {
    return { isValid: false, error: 'proxyUrl must be a string' }
  }

  let parsed: URL
  try {
    parsed = new URL(proxyUrl)
  } catch {
    return { isValid: false, error: 'proxyUrl must be a valid URL' }
  }

  if (parsed.protocol !== 'http:') {
    return {
      isValid: false,
      error: 'proxyUrl must use http:// (https/socks proxies are not supported)',
    }
  }

  // The `proxy` profile is what holds a proxy to a stricter rule than the
  // destinations it fronts: plain HTTP by protocol, but public addresses only,
  // and no operator allowlist — a private proxy host stays blocked even on a
  // deployment that has allowlisted that range for everything else.
  const validation = await validateUrlWithDNS(proxyUrl, 'proxyUrl', 'proxy')
  if (!validation.isValid) {
    return { isValid: false, error: validation.error }
  }

  const resolvedIP = validation.resolvedIP

  // Bracket IPv6 literals: assigning an unbracketed IPv6 address to URL.hostname
  // is a no-op, which would leave the DNS hostname in place and reopen rebinding.
  parsed.hostname = resolvedIP.includes(':') ? `[${resolvedIP}]` : resolvedIP
  return { isValid: true, pinnedProxyUrl: parsed.toString() }
}

/**
 * Validates a database hostname by resolving DNS and checking the resolved IP
 * against private/reserved ranges to prevent SSRF via database connections.
 *
 * Permissive about hostname format, so a legitimate database host is not
 * rejected on shape alone — Docker and K8s service names carry underscores that
 * a strict RFC check would refuse. Only the address is judged.
 *
 * Self-hosted operators reach a database on their private network (e.g. a
 * Docker/Swarm service name that resolves to an internal IP) by naming it in the
 * shared egress allowlist — the same one that governs HTTP destinations, because
 * "may this deployment talk to that host" is one question, not one per protocol.
 * DNS is still resolved so the caller can pin the connection to the resolved IP,
 * and the allowlist is never honored on the hosted platform.
 *
 * A database host carries no scheme or port of its own, so it is evaluated as an
 * `https` destination: the address rules and the allowlist apply, the HTTP-only
 * scheme and port rules do not.
 *
 * @param host - The database hostname to validate
 * @param paramName - Name of the parameter for error messages
 * @returns AsyncValidationResult with resolved IP
 */
export async function validateDatabaseHost(
  host: string | null | undefined,
  paramName = 'host'
): Promise<AsyncValidationResult> {
  if (!host) {
    return { isValid: false, error: `${paramName} is required` }
  }

  const cleanHost = unwrapIpv6Brackets(host.toLowerCase())

  let asUrl: URL
  try {
    asUrl = new URL(
      `https://${isIpLiteral(cleanHost) && cleanHost.includes(':') ? `[${cleanHost}]` : cleanHost}`
    )
  } catch {
    return { isValid: false, error: `${paramName} is not a valid host` }
  }

  if (isIpLiteral(cleanHost)) {
    const decision = checkResolvedEgress(asUrl, cleanHost, 'databaseHost')
    if (!decision.allowed) {
      return { isValid: false, error: describeEgressDenial(decision, paramName, 'databaseHost') }
    }
    return { isValid: true, resolvedIP: cleanHost, originalHostname: host }
  }

  try {
    const { addresses } = await resolveHostAddresses(cleanHost)
    let refusal: Extract<EgressDecision, { allowed: false }> | undefined
    const blocked = addresses.find((candidate) => {
      const decision = checkResolvedEgress(asUrl, candidate, 'databaseHost')
      if (decision.allowed) return false
      refusal = decision
      return true
    })

    if (refusal !== undefined) {
      logger.warn('Database host resolves to blocked IP address', {
        paramName,
        hostname: host,
        resolvedIP: blocked,
      })
      return { isValid: false, error: describeEgressDenial(refusal, paramName, 'databaseHost') }
    }

    return {
      isValid: true,
      resolvedIP: preferIpv4(addresses as [string, ...string[]]),
      originalHostname: host,
    }
  } catch (error) {
    logger.warn('DNS lookup failed for database host', {
      paramName,
      hostname: host,
      error: toError(error).message,
    })
    return {
      isValid: false,
      error: `${paramName} hostname could not be resolved`,
    }
  }
}

/**
 * Patterns run against the WHERE clause with string/identifier literals masked
 * out (so an attacker cannot smuggle `OR 1` or `; DROP` inside a quoted value).
 *
 * The connector-literal rules below are intentionally `OR`-only: only an
 * `OR <truthy>` term broadens a mutation to every row. `AND <number>` is a no-op
 * for broadening and is also exactly what `BETWEEN low AND high` produces, so
 * matching it would reject legitimate range filters (e.g. `id BETWEEN 1 AND 10`).
 */
const SQL_WHERE_MASKED_PATTERNS: readonly RegExp[] = [
  /;\s*\w/, // stacked statement
  /\bunion\s+(?:all\s+)?select\b/i,
  /\binto\s+(?:out|dump)file\b/i,
  /--/,
  /\/\*/,
  /\*\//,
  /\b(?:sleep|pg_sleep|benchmark)\s*\(/i,
  /\b(\w+)\s*=\s*\1\b/i, // same (unquoted) operand both sides: x=x, 1=1
  /\b\d+(?:\.\d+)?\s*(?:=|==|<>|!=|<=|>=|<|>)\s*\d+(?:\.\d+)?\b/, // constant vs constant: 1=1, 1<2, 2>1
  /\bor\s+(?:true|false)\b/i, // OR TRUE / OR FALSE
  /\bor\s+\d+(?:\.\d+)?\b(?!\s*[=<>!+\-*/%])/i, // standalone truthy literal after OR: OR 1, OR 42
  /^\s*(?:\d+(?:\.\d+)?|true|false)\s*$/i, // bare constant: "1" / "true" / "false"
]

/**
 * Patterns run against the raw WHERE clause (need the literal contents intact),
 * e.g. equality between two identical string literals.
 */
const SQL_WHERE_RAW_PATTERNS: readonly RegExp[] = [
  /(['"])([^'"]*)\1\s*(?:=|==|<>|!=)\s*\1\2\1/, // 'a'='a' / "x"="x"
]

/**
 * Replaces the contents of string literals ('...'), double-quoted and
 * backtick-quoted identifiers with spaces (preserving length) so structural
 * scans do not treat data inside quotes as SQL. Comments are intentionally left
 * intact so comment-injection sequences are still detected.
 */
export function maskSqlStringLiterals(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ' '
      i++
      while (i < sql.length && sql[i] !== ch) {
        if (ch !== '`' && sql[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += ' '
        i++
      }
      if (i < sql.length) {
        out += ' '
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Validates a free-form SQL `WHERE` condition for injection and always-true
 * tautology patterns. Returns a {@link ValidationResult}; callers decide whether
 * to throw or surface the error.
 *
 * IMPORTANT: this is **defense-in-depth, not a security boundary**. A free-form
 * SQL condition cannot be exhaustively validated against every always-true
 * expression (e.g. `OR 2 > 1`, `OR (1)`, `OR NOT 0`, `OR length(x) >= 0`). The
 * real boundary is that the caller supplies their own database credentials and
 * could run equivalent SQL directly (e.g. via a raw-SQL/execute operation). This
 * guard stops the easy, obvious ways an injected condition broadens a mutation
 * to every row; it is not a substitute for constraining untrusted input upstream.
 *
 * @param where - The WHERE clause condition (without the `WHERE` keyword)
 * @param paramName - Label used in the error message
 */
export function validateSqlWhereClause(
  where: string | null | undefined,
  paramName = 'WHERE clause'
): ValidationResult {
  if (typeof where !== 'string' || where.trim().length === 0) {
    return { isValid: false, error: `${paramName} is required` }
  }

  const masked = maskSqlStringLiterals(where)
  const matched =
    SQL_WHERE_MASKED_PATTERNS.some((pattern) => pattern.test(masked)) ||
    SQL_WHERE_RAW_PATTERNS.some((pattern) => pattern.test(where))

  if (matched) {
    return {
      isValid: false,
      error: `${paramName} contains a disallowed or always-true expression`,
    }
  }

  return { isValid: true }
}

export interface SecureFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer | Uint8Array
  timeout?: number
  maxRedirects?: number
  /**
   * Maximum bytes read from the response body. Defaults to
   * {@link DEFAULT_MAX_RESPONSE_BYTES} — there is deliberately no "unlimited" mode, since
   * many callers target a user-supplied host that can stream an endless body.
   */
  maxResponseBytes?: number
  signal?: AbortSignal
  /**
   * Drop the Authorization header when following any redirect, including a same-origin hop.
   * Use this for endpoints that redirect to a target carrying its own signed URL.
   */
  stripAuthOnRedirect?: boolean
  /** Omit for the historical behavior used by existing workflows. */
  redirectPolicy?: HttpRedirectPolicy
  /** Rejects a redirect target before DNS resolution or a follow-up request is attempted. */
  assertRedirectTarget?: (url: string) => void
  /**
   * Pre-validated, IP-pinned `http://` proxy URL (see {@link validateAndPinProxyUrl}).
   * When set, the connection routes through this proxy and target-IP pinning is
   * bypassed (the proxy resolves the target).
   */
  proxyUrl?: string
  /**
   * Where this request's URL came from. Carried on the options so the same
   * policy is re-applied to every redirect hop rather than re-derived — a hop
   * evaluated under a laxer policy than the origin is how a redirect chain
   * escapes the guard it started under.
   */
  profile: EgressProfile
}

export class SecureFetchHeaders {
  private headers: Map<string, string>
  private setCookies: string[]

  constructor(headers: Record<string, string>, setCookies: string[] = []) {
    this.headers = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    this.setCookies = setCookies
  }

  get(name: string): string | null {
    return this.headers.get(name.toLowerCase()) ?? null
  }

  /** Returns the raw `Set-Cookie` header values as an array. Each entry is one cookie. */
  getSetCookie(): string[] {
    return [...this.setCookies]
  }

  toRecord(): Record<string, string> {
    const record: Record<string, string> = {}
    for (const [key, value] of this.headers) {
      record[key] = value
    }
    return record
  }

  [Symbol.iterator]() {
    return this.headers.entries()
  }
}

export interface SecureFetchResponse {
  ok: boolean
  status: number
  statusText: string
  headers: SecureFetchHeaders
  body: ReadableStream<Uint8Array> | null
  text: () => Promise<string>
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
}

const DEFAULT_MAX_REDIRECTS = 5

/**
 * Fail-safe ceiling applied by {@link secureFetchWithPinnedIP} when the caller does not
 * pass `maxResponseBytes`. Many callers fetch a user-supplied host, so an omitted cap
 * would let a malicious upstream stream an endless chunked body into memory until the
 * process is OOM-killed. Set to the platform's largest legitimate payload (100MB, matching
 * the upload limit); callers that need more must opt in explicitly, and callers handling
 * small JSON should pass a much tighter cap.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024

/** Response cap for JSON/control-plane proxies to user-supplied hosts. */
export const MAX_JSON_API_RESPONSE_BYTES = 10 * 1024 * 1024

/**
 * The statuses that name a new destination to request. 300, 305 and 306 are
 * deliberately absent: 305 (Use Proxy) redirects a request into a server-named
 * proxy, which is the one hop a guard must never take, and the other two carry
 * no single target.
 */
const FOLLOWED_REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

function isRedirectStatus(status: number): boolean {
  return FOLLOWED_REDIRECT_STATUSES.has(status)
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function resolveRedirectUrl(baseUrl: string, location: string): string {
  try {
    return new URL(location, baseUrl).toString()
  } catch {
    throw new Error(`Invalid redirect location: ${location}`)
  }
}

/**
 * Creates a DNS lookup function that always returns a pre-resolved IP address.
 * Use this to prevent DNS rebinding (TOCTOU) attacks when connecting to
 * user-controlled hostnames via non-HTTP protocols (SMTP, SSH, IMAP, etc.).
 */
export function createPinnedLookup(resolvedIP: string): LookupFunction {
  const isIPv6 = resolvedIP.includes(':')
  const family = isIPv6 ? 6 : 4

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: resolvedIP, family }])
    } else {
      callback(null, resolvedIP, family)
    }
  }
}

/**
 * DNS lookup that resolves normally and validates EVERY resolved address against
 * the SSRF policy at socket-connect time (the LibreChat `getSSRFConnect` pattern).
 * Private/reserved/loopback records are filtered out; if nothing publicly routable
 * remains the connect fails. Because the check runs on each dial — including
 * redirects and reconnects — there is no validated-then-trusted window for a DNS
 * rebind to slip through, and unlike single-IP pinning the connector keeps the
 * full public address set, so the OS/undici can fall back across addresses.
 * IPv4 is ordered first (`verbatim: false`) — our egress is IPv4-only.
 */
function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function createSsrfGuardedLookup(profile: EgressProfile): LookupFunction {
  return (hostname, options, callback) => {
    // Scheme and port were judged when the request URL was checked, so this
    // stage only classifies addresses — but it classifies them against the
    // request's own policy, so a destination the operator allowlisted is not
    // stranded here after the redirect check permitted it.
    const asUrl = safeParseUrl(`https://${hostname}`)
    dns
      .lookup(hostname, { all: true, verbatim: false })
      .then((addresses) => {
        const usable =
          asUrl === null
            ? []
            : addresses.filter(
                (entry) => checkResolvedEgress(asUrl, entry.address, profile).allowed
              )
        if (usable.length === 0) {
          callback(
            new Error(`Blocked by SSRF policy: ${hostname} has no publicly routable address`),
            '',
            4
          )
          return
        }
        if (options.all) callback(null, usable)
        else callback(null, usable[0].address, usable[0].family)
      })
      .catch((error) => callback(toError(error), '', 4))
  }
}

/** The undici follower's fixed cap; the same value the node path defaults to. */
const MAX_GUARDED_REDIRECTS = DEFAULT_MAX_REDIRECTS

/**
 * Rejects a redirect hop whose target is a private/reserved IP LITERAL. Node's
 * `net.connect` bypasses the custom `lookup` for numeric hosts (`isIP(host)`
 * short-circuits), so the connect-time guard never sees IP-literal dials —
 * a 3xx to `http://169.254.169.254/` would otherwise connect directly. Hostname
 * targets are covered by {@link createSsrfGuardedLookup} at connect time.
 */
function assertGuardedRedirectTarget(
  url: URL,
  profile: EgressProfile,
  knownAddress?: string
): void {
  const host = unwrapIpv6Brackets(url.hostname)

  // The request's own policy decides, which is how a self-hosted server on a
  // permitted private address stays reachable across a hop.
  //
  // A literal is judged completely here, and takes precedence over any address a
  // caller resolved earlier: `net.connect` dials a numeric host directly, so the
  // literal is what the socket will reach. A hostname is judged on
  // `knownAddress` when the caller resolved this exact URL — a range-allowlist
  // match is only visible post-DNS — and otherwise gets the pre-DNS half, scheme
  // and port, with its address left to the connect-time lookup.
  const decision = isIpLiteral(host)
    ? checkResolvedEgress(url, host, profile)
    : knownAddress
      ? checkResolvedEgress(url, knownAddress, profile)
      : checkEgressUrl(url, profile)

  if (!decision.allowed) {
    throw new Error(
      `Blocked by SSRF policy: ${describeEgressDenial(decision, 'redirect', profile)}`
    )
  }
}

/** Headers that describe a request body and must not outlive it. */
const ENTITY_HEADERS = [
  'content-length',
  'content-type',
  'content-encoding',
  'content-language',
  'content-location',
  'transfer-encoding',
] as const

/** Case-insensitive header removal — callers supply arbitrary casing. */
function stripHeaders(
  headers: Record<string, string>,
  remove: readonly string[]
): Record<string, string> {
  const drop = new Set(remove.map((name) => name.toLowerCase()))
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!drop.has(name.toLowerCase())) kept[name] = value
  }
  return kept
}

interface RedirectHopPolicy {
  /** Method for the next hop. */
  method: string
  /** Whether the body — and the entity headers describing it — must be dropped. */
  dropBody: boolean
}

/**
 * Decides how a request may be replayed on a redirect target, per RFC 9110 section 15.4.
 *
 * `HEAD` is deliberately preserved on 303. Fetch only changes a 303 to GET when the
 * current method is neither GET nor HEAD.
 */
function resolveRedirectHop(args: { status: number; method: string }): RedirectHopPolicy {
  const method = args.method.toUpperCase()
  const isGetOrHead = method === 'GET' || method === 'HEAD'
  const dropBody =
    (args.status === 303 && !isGetOrHead) ||
    ((args.status === 301 || args.status === 302) && method === 'POST')
  return {
    method: dropBody ? 'GET' : method,
    dropBody,
  }
}

const CROSS_ORIGIN_CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie'] as const

/**
 * Manual, revalidating redirect follower used by the guarded fetch. Auto-follow
 * is unsafe here on two counts the connect-time lookup cannot cover: IP-literal
 * redirect targets bypass the lookup entirely (validated per hop instead), and
 * undici retains CUSTOM request headers across cross-origin redirects (it strips
 * only Authorization/Cookie) — so caller headers are dropped on any cross-origin
 * hop. Exported for tests.
 */
export async function followRedirectsGuarded(
  rawFetch: (url: string, init: UndiciRequestInit) => Promise<Response>,
  input: string,
  init: UndiciRequestInit,
  profile: EgressProfile,
  initialAddress?: string
): Promise<Response> {
  let currentUrl = new URL(input)
  // The initial URL is checked too, so the guard is self-contained even when a
  // caller skips its own up-front validation. A caller that already resolved it
  // passes that address, so a destination allowlisted by range is not refused
  // here for want of a lookup. Redirect hops are always judged afresh.
  assertGuardedRedirectTarget(currentUrl, profile, initialAddress)
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  let headers = init.headers
  for (let hop = 0; ; hop++) {
    const response = await rawFetch(currentUrl.href, {
      ...init,
      method,
      body,
      headers,
      redirect: 'manual',
    })
    const status = response.status
    const location = response.headers.get('location')
    if (!isRedirectStatus(status) || !location) {
      // `response.url` is already the final hop's URL (set per-request by the raw fetch); flag
      // `redirected` too when at least one hop was followed, matching fetch semantics.
      if (hop > 0)
        Object.defineProperty(response, 'redirected', { value: true, configurable: true })
      return response
    }
    // Cancel the redirect body up front so the throw paths below (hop cap, blocked
    // target) can't leave a socket checked out on the long-lived Agent.
    await response.body?.cancel().catch(() => {})
    if (hop >= MAX_GUARDED_REDIRECTS) {
      throw new Error(`Blocked by SSRF policy: more than ${MAX_GUARDED_REDIRECTS} redirects`)
    }
    const nextUrl = new URL(location, currentUrl)
    assertGuardedRedirectTarget(nextUrl, profile)
    const hopPolicy = resolveRedirectHop({
      status,
      method,
    })
    method = hopPolicy.method
    if (hopPolicy.dropBody) body = undefined
    if (nextUrl.origin !== currentUrl.origin) {
      headers = undefined
      if (body !== undefined && body !== null) {
        throw new Error(
          'Blocked by SSRF policy: cross-origin redirect would forward a request body'
        )
      }
    } else if (hopPolicy.dropBody && headers !== undefined) {
      const sanitized = new Headers(headers as HeadersInit)
      for (const name of ENTITY_HEADERS) sanitized.delete(name)
      // double-cast-allowed: Headers is a valid undici HeadersInit at runtime but the DOM/undici types differ
      headers = sanitized as unknown as UndiciRequestInit['headers']
    }
    currentUrl = nextUrl
  }
}

/** Coerce a DOM/undici `HeadersInit` into the record shape undici `request` accepts. */
function toUndiciRequestHeaders(
  headers: UndiciRequestInit['headers']
): Record<string, string> | undefined {
  if (!headers) return undefined
  const record: Record<string, string> = {}
  if (Array.isArray(headers)) {
    for (const [key, value] of headers as [string, string][]) {
      if (value != null) record[key] = String(value)
    }
    return record
  }
  // Single cast (no `as unknown`): the optional `forEach` is satisfiable by both a plain
  // record (absent) and a `Headers` instance (present), so it detects the iterable form.
  const iterableHeaders = headers as {
    forEach?: (cb: (value: string, key: string) => void) => void
  }
  if (typeof iterableHeaders.forEach === 'function') {
    iterableHeaders.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value != null) record[key] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return record
}

/** Coerce a DOM/undici body init into a value undici `request` accepts. */
function toUndiciRequestBody(
  body: UndiciRequestInit['body']
): string | Buffer | Uint8Array | Readable | undefined {
  if (body == null) return undefined
  // fetch accepts URLSearchParams (form-encoded) and undici.request does not — the MCP SDK's
  // OAuth token/refresh exchange sends one. Serialize it to its wire form.
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body) && !(body instanceof Uint8Array)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (typeof (body as ReadableStream).getReader === 'function') {
    // double-cast-allowed: DOM ReadableStream and the node:stream Web type differ but are structurally compatible at runtime
    return Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0])
  }
  // string, Uint8Array/Buffer, or Readable — passed through unchanged.
  // double-cast-allowed: undici BodyInit is wider than what request() accepts; our guarded/pinned callers only send these
  return body as unknown as string | Buffer | Uint8Array | Readable
}

/**
 * Decompression transform for a `Content-Encoding`, or `null` to pass the body through.
 * `undici.fetch` decodes the body automatically; `undici.request` does not, so this restores
 * fetch parity for gzip/deflate/br responses (common behind CDNs). Unknown/absent encodings
 * pass through untouched.
 */
function contentEncodingDecoder(
  encoding: string
): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip()
    case 'deflate':
      return zlib.createInflate()
    case 'br':
      return zlib.createBrotliDecompress()
    default:
      return null
  }
}

/**
 * Streaming-safe replacement for `undiciFetch(url, { ...init, dispatcher })`.
 *
 * undici's `fetch` exposes the response body as a WHATWG `ReadableStream` whose
 * bridge is broken under the Bun runtime (which the standalone server runs on):
 * response headers arrive but `response.body` never yields data, hanging every
 * incremental read — MCP SSE `tools/list`, provider streaming — to its timeout.
 * undici's lower-level `request()` returns a Node `Readable` instead, which Bun
 * implements natively and streams correctly; `Readable.toWeb` bridges it back to
 * a spec `Response`. Buffered reads (`.json()`/`.text()`/`.arrayBuffer()`) behave
 * identically on both runtimes, so this is a drop-in substitute.
 *
 * SSRF is unchanged: the same `dispatcher` (Agent carrying the guarded/pinned
 * `connect.lookup`) governs every connection, and `maxResponseSize` still caps the
 * body. Redirects are NOT followed here (`maxRedirections: 0`); the caller drives
 * them via {@link followRedirectsGuarded}, exactly as it did over `fetch`'s
 * `redirect: 'manual'`.
 */
async function undiciRequestAsResponse(
  input: RequestInfo | URL,
  init: RequestInit,
  dispatcher: Dispatcher
): Promise<Response> {
  let url: string
  let effectiveInit = init as UndiciRequestInit
  if (typeof Request !== 'undefined' && input instanceof Request) {
    // A Request input carries its own method/headers/body/signal; lift them (explicit
    // init fields win, per fetch semantics) so a guarded POST isn't downgraded to GET.
    const bodyAllowed = input.method !== 'GET' && input.method !== 'HEAD'
    effectiveInit = {
      method: input.method,
      headers: input.headers,
      body: bodyAllowed ? await input.clone().arrayBuffer() : undefined,
      signal: input.signal,
      ...(init as UndiciRequestInit),
      // double-cast-allowed: DOM RequestInit and undici RequestInit differ in TS but match at runtime
    } as unknown as UndiciRequestInit
    url = input.url
  } else {
    url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  }

  const method = (effectiveInit.method ?? 'GET').toUpperCase()
  const canHaveBody = method !== 'GET' && method !== 'HEAD'
  const requestHeaders = toUndiciRequestHeaders(effectiveInit.headers) ?? {}
  const requestBody = canHaveBody ? toUndiciRequestBody(effectiveInit.body) : undefined
  // fetch auto-adds a form content-type for a URLSearchParams body; preserve that parity
  // when the caller didn't set one (the MCP SDK does set it explicitly, but not every caller).
  if (
    canHaveBody &&
    effectiveInit.body instanceof URLSearchParams &&
    !Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type')
  ) {
    requestHeaders['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }
  const { statusCode, headers, body } = await undiciRequest(url, {
    method: method as Dispatcher.HttpMethod,
    headers: requestHeaders,
    body: requestBody,
    signal: effectiveInit.signal ?? undefined,
    dispatcher,
    // No `maxRedirections`: request() does not auto-follow by default, so the caller's
    // `followRedirectsGuarded` drives every hop with per-hop SSRF validation.
  })

  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const v of value) responseHeaders.append(key, v)
    else if (value != null) responseHeaders.append(key, value)
  }

  // Null-body statuses (204/205/304) can't carry a body; drain undici's (empty) stream so its
  // socket returns to the pool. Attach an error listener first so a socket reset mid-drain
  // surfaces as a handled event, not an unhandled 'error' that crashes the process.
  const isNullBody = statusCode === 204 || statusCode === 205 || statusCode === 304
  if (isNullBody) {
    body.on('error', () => {})
    body.resume()
    const response = new Response(null, { status: statusCode, headers: responseHeaders })
    Object.defineProperty(response, 'url', { value: url, configurable: true })
    return response
  }

  // Decode Content-Encoding like `fetch` does (`request()` returns raw bytes). `maxResponseSize`
  // still caps the compressed wire bytes on `body`.
  const contentEncoding = String(headers['content-encoding'] ?? '')
    .toLowerCase()
    .trim()
  const decoder = contentEncodingDecoder(contentEncoding)
  if (decoder) {
    // The bridged body is now decoded; drop framing headers that would misdescribe it.
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
  }
  // Build the bridge over the stream the consumer reads (the decoder when decoding).
  // `nodeReadableToWebStream` attaches its `error` listener synchronously, so wiring the pipe
  // AFTER it means a synchronous zlib error (e.g. a server mislabeling a non-gzip body as gzip)
  // is caught and rejects the reader instead of taking down the process.
  const webBody = nodeReadableToWebStream(decoder ?? body)
  if (decoder) {
    body.once('error', (err) => decoder.destroy(err)) // forward maxResponseSize / socket reset
    decoder.once('close', () => body.destroy()) // tear the source down so the socket can't leak
    body.pipe(decoder)
  }

  try {
    const response = new Response(webBody, { status: statusCode, headers: responseHeaders })
    // undici.request never sets `url`; `fetch` did, and consumers rely on it (the MCP
    // transport's response-cap wrapper copies it; the SDK resolves relative
    // auth-metadata URLs against it). Preserve parity.
    Object.defineProperty(response, 'url', { value: url, configurable: true })
    return response
  } catch (err) {
    // `new Response` rejects an out-of-range status (a 1xx undici shouldn't surface, but
    // defensively): destroy the source so its socket can't leak, then rethrow.
    body.destroy()
    throw err
  }
}

/**
 * Normalizes a `fetch(input, init)` call into a URL string + init. A `Request` input carries
 * its own method/headers/body/signal; lift them into the init (explicit init fields win, per
 * fetch semantics) so a manual redirect follower can't silently downgrade a POST Request to a
 * bare GET or lose its headers.
 */
async function liftFetchArgs(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ target: string; effectiveInit: RequestInit }> {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const bodyAllowed = input.method !== 'GET' && input.method !== 'HEAD'
    return {
      target,
      effectiveInit: {
        method: input.method,
        headers: input.headers,
        body: bodyAllowed ? await input.clone().arrayBuffer() : undefined,
        signal: input.signal,
        // Carry the Request's redirect mode so the pinned fetch honors `manual`/`error`
        // instead of defaulting a `Request({ redirect: 'manual' })` to `follow`.
        redirect: input.redirect,
        ...init,
      },
    }
  }
  return { target, effectiveInit: init ?? {} }
}

/**
 * SSRF-guarded `fetch` + its `Agent` for outbound requests to user-controlled
 * hosts: DNS resolves normally, and every socket connect validates the chosen
 * addresses via {@link createSsrfGuardedLookup}; redirects are followed manually
 * with per-hop validation (see {@link followRedirectsGuarded}) so IP-literal
 * targets can't bypass the lookup and custom headers never cross origins. See
 * {@link createPinnedFetchWithDispatcher} for the `maxResponseSize` semantics.
 */
export function createSsrfGuardedFetchWithDispatcher(options: {
  profile: EgressProfile
  maxResponseSize?: number
}): {
  fetch: typeof fetch
  dispatcher: Agent
} {
  const dispatcher = new Agent({
    allowH2: false,
    connect: { lookup: createSsrfGuardedLookup(options.profile) },
    ...(options.maxResponseSize !== undefined ? { maxResponseSize: options.maxResponseSize } : {}),
  })

  const rawFetch = (url: string, init: UndiciRequestInit): Promise<Response> =>
    // double-cast-allowed: DOM RequestInit and undici RequestInit differ in TS but match at runtime
    undiciRequestAsResponse(url, init as unknown as RequestInit, dispatcher)

  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { target, effectiveInit } = await liftFetchArgs(input, init)
    return followRedirectsGuarded(
      rawFetch,
      target,
      // double-cast-allowed: DOM RequestInit and undici RequestInit are structurally compatible at runtime but the TS types differ
      effectiveInit as unknown as UndiciRequestInit,
      options.profile
    )
  }

  return { fetch: guarded, dispatcher }
}

/**
 * Builds a standard `fetch`-compatible function that pins every outbound
 * connection to `resolvedIP`, preventing DNS-rebinding (TOCTOU) between URL
 * validation and connection. The original hostname is preserved for TLS SNI and
 * the `Host` header so it still matches the certificate. This is the single
 * source of truth for pinned outbound fetches — both the LLM providers and the
 * MCP transport consume it.
 *
 * Pass the returned function as the `fetch` option to the OpenAI/Anthropic SDKs
 * (or call it directly) after validating the URL with {@link validateUrlWithDNS}
 * and capturing `resolvedIP`. Because the pinned lookup always returns
 * `resolvedIP` regardless of hostname, any redirect the server returns also
 * connects to the validated IP — an attacker cannot rebind a redirect target to
 * an internal address.
 *
 * The `Agent` is captured for the lifetime of the returned function, so repeated
 * calls (e.g. a provider tool loop) reuse its keep-alive connections.
 *
 * `allowH2` opts the pinned Agent into HTTP/2 (ALPN-negotiated, h1.1 fallback).
 * It defaults to `false` to leave existing consumers unchanged. Enabling it does
 * not weaken pinning: the pinned `connect.lookup` forces every connection on the
 * Agent to `resolvedIP` regardless of authority, so h2 connection coalescing can
 * never reach an address other than the validated one.
 */
export function createPinnedFetch(
  resolvedIP: string,
  options: { profile: EgressProfile; allowH2?: boolean }
): typeof fetch {
  return createPinnedFetchWithDispatcher(resolvedIP, options).fetch
}

/**
 * Same as {@link createPinnedFetch} but also returns the underlying `Agent` so a
 * caller with a defined connection lifetime (e.g. a long-lived MCP transport) can
 * tear the Agent down on close instead of waiting for its idle timeout. Closing
 * the Agent is what releases any pooled keep-alive / HTTP/2 sockets it holds.
 *
 * `maxResponseSize` caps the (decoded) response body in bytes and makes undici reject
 * with `UND_ERR_RES_EXCEEDED_MAX_SIZE` once exceeded — a DoS backstop for one-shot
 * callers reading from a URL taken from untrusted metadata. Omit it (the default) to
 * leave the response unbounded, which streaming consumers like the MCP transport need.
 */
export function createPinnedFetchWithDispatcher(
  resolvedIP: string,
  options: { profile: EgressProfile; allowH2?: boolean; maxResponseSize?: number }
): { fetch: typeof fetch; dispatcher: Agent } {
  const dispatcher = new Agent({
    allowH2: options.allowH2 ?? false,
    connect: { lookup: createPinnedLookup(resolvedIP) },
    ...(options.maxResponseSize !== undefined ? { maxResponseSize: options.maxResponseSize } : {}),
  })

  const rawFetch = (url: string, init: UndiciRequestInit): Promise<Response> =>
    // double-cast-allowed: DOM RequestInit and undici RequestInit differ in TS but match at runtime
    undiciRequestAsResponse(url, init as unknown as RequestInit, dispatcher)

  // Requests go through `undici.request` (not `undici.fetch`) because fetch's streaming
  // `response.body` never delivers under the Bun runtime the server runs on — the same bug
  // {@link createSsrfGuardedFetchWithDispatcher} works around. Redirects are handled here (not
  // by a caller's wrapper — the pinned fetch is passed straight to provider/A2A SDKs), honoring
  // the request's `redirect` mode: `manual`/`error` must NOT transparently follow (e.g.
  // `detectMcpAuthType` inspects the 3xx to classify auth). The default `follow` uses
  // {@link followRedirectsGuarded}, which drops headers on cross-origin hops (so a redirect
  // can't disclose a provider `api-key` to another origin) and stamps the final `response.url`.
  // Every hop still dispatches through the pinned `Agent` (its `connect.lookup` forces
  // `resolvedIP`), so a redirect can't escape to another address.
  const pinned = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { target, effectiveInit } = await liftFetchArgs(input, init)
    const mode = effectiveInit.redirect ?? 'follow'
    // double-cast-allowed: DOM RequestInit and undici RequestInit are structurally compatible at runtime but the TS types differ
    const undiciInit = effectiveInit as unknown as UndiciRequestInit
    if (mode === 'manual') {
      return rawFetch(target, undiciInit)
    }
    if (mode === 'error') {
      const response = await rawFetch(target, undiciInit)
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => {})
        throw new TypeError('Pinned fetch received an unexpected redirect (redirect: "error")')
      }
      return response
    }
    return followRedirectsGuarded(rawFetch, target, undiciInit, options.profile, resolvedIP)
  }

  return { fetch: pinned, dispatcher }
}

/**
 * Performs a fetch with IP pinning to prevent DNS rebinding attacks.
 * Uses the pre-resolved IP address while preserving the original hostname for TLS SNI.
 * Follows redirects securely by validating each redirect target.
 *
 * The response body is always bounded — `options.maxResponseBytes` when supplied (and
 * positive), otherwise {@link DEFAULT_MAX_RESPONSE_BYTES}. Exceeding the cap rejects with
 * a {@link PayloadSizeLimitError} and destroys the socket.
 */
export async function secureFetchWithPinnedIP(
  url: string,
  resolvedIP: string,
  options: SecureFetchOptions,
  redirectCount = 0
): Promise<SecureFetchResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const requestedMaxResponseBytes = options.maxResponseBytes
  const maxResponseBytes =
    typeof requestedMaxResponseBytes === 'number' && requestedMaxResponseBytes > 0
      ? requestedMaxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const defaultPort = isHttps ? 443 : 80
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort

    let agent: http.Agent
    if (options.proxyUrl) {
      // Proxy connection is already IP-pinned by validateAndPinProxyUrl; target-IP
      // pinning is intentionally bypassed (the proxy resolves the target). https
      // targets tunnel via CONNECT, http targets use absolute-URI forwarding.
      agent = isHttps ? new HttpsProxyAgent(options.proxyUrl) : new HttpProxyAgent(options.proxyUrl)
    } else {
      const lookup = createPinnedLookup(resolvedIP)
      const agentOptions: http.AgentOptions = { lookup }
      agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions)
    }

    const { 'accept-encoding': _, ...sanitizedHeaders } = options.headers ?? {}

    const requestOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: sanitizedHeaders,
      agent,
      timeout: options.timeout || 300000,
    }

    const protocol = isHttps ? https : http
    const req = protocol.request(requestOptions, (res) => {
      const statusCode = res.statusCode || 0
      const location = res.headers.location

      if (isRedirectStatus(statusCode) && location && redirectCount < maxRedirects) {
        res.resume()
        const redirectUrl = resolveRedirectUrl(url, location)

        try {
          options.assertRedirectTarget?.(redirectUrl)
        } catch (error) {
          settledReject(error)
          return
        }
        validateUrlWithDNS(redirectUrl, 'redirectUrl', options.profile)
          .then((validation) => {
            if (!validation.isValid) {
              settledReject(new Error(`Redirect blocked: ${validation.error}`))
              return
            }
            const redirectPolicy = options.redirectPolicy
            const isCrossOrigin = new URL(redirectUrl).origin !== parsed.origin
            // Legacy mode replays the method and body verbatim on every status,
            // which is what persisted workflows were built against.
            const hop =
              redirectPolicy?.mode === 'standard'
                ? resolveRedirectHop({ status: statusCode, method: options.method ?? 'GET' })
                : { method: options.method ?? 'GET', dropBody: false }
            let redirectHeaders = options.headers
            if (redirectHeaders && hop.dropBody) {
              redirectHeaders = stripHeaders(redirectHeaders, ENTITY_HEADERS)
            }
            // A cross-origin hop must not hand a credential to whatever host the
            // redirect named. With no redirect policy the caller has not
            // declared which of its headers are sensitive, so — matching the
            // undici follower — none survive: a custom credential header
            // (`PRIVATE-TOKEN`, `x-api-key`) cannot leak. A policy keeps
            // non-credential headers, dropping the standard credentials and any
            // it named sensitive, unless it opts into forwarding them. `host`
            // always goes: it describes the old origin.
            if (redirectHeaders && isCrossOrigin) {
              if (!redirectPolicy) {
                redirectHeaders = undefined
              } else {
                const keepCredentials = redirectPolicy.sendCredentialsOnCrossOriginRedirect === true
                redirectHeaders = stripHeaders(
                  redirectHeaders,
                  keepCredentials
                    ? ['host']
                    : [
                        'host',
                        ...CROSS_ORIGIN_CREDENTIAL_HEADERS,
                        ...(redirectPolicy.sensitiveHeaders ?? []),
                      ]
                )
              }
            }
            if (redirectHeaders && options.stripAuthOnRedirect) {
              redirectHeaders = stripHeaders(redirectHeaders, ['authorization'])
            }
            const redirectBody = hop.dropBody ? undefined : options.body
            // Refusing rather than quietly dropping the body: a bodyless replay
            // of a POST is a different request, and the caller cannot tell it
            // happened. Matches followRedirectsGuarded.
            if (
              isCrossOrigin &&
              redirectBody !== undefined &&
              redirectBody !== null &&
              redirectPolicy?.allowCrossOriginBody !== true
            ) {
              settledReject(
                new Error(
                  'Blocked by SSRF policy: cross-origin redirect would forward a request body'
                )
              )
              return
            }
            const redirectOptions: SecureFetchOptions = {
              ...options,
              method: hop.method,
              body: redirectBody,
              headers: redirectHeaders,
            }
            return secureFetchWithPinnedIP(
              redirectUrl,
              validation.resolvedIP,
              redirectOptions,
              redirectCount + 1
            )
          })
          .then((response) => {
            if (response) settledResolve(response)
          })
          .catch(settledReject)
        return
      }

      if (isRedirectStatus(statusCode) && location && redirectCount >= maxRedirects) {
        res.resume()
        settledReject(new Error(`Too many redirects (max: ${maxRedirects})`))
        return
      }

      const headersRecord: Record<string, string> = {}
      let setCookieArray: string[] = []
      for (const [key, value] of Object.entries(res.headers)) {
        const lowerKey = key.toLowerCase()
        if (lowerKey === 'set-cookie') {
          if (Array.isArray(value)) {
            setCookieArray = value
            headersRecord[lowerKey] = value.join(', ')
          } else if (typeof value === 'string') {
            setCookieArray = [value]
            headersRecord[lowerKey] = value
          }
        } else if (typeof value === 'string') {
          headersRecord[lowerKey] = value
        } else if (Array.isArray(value)) {
          headersRecord[lowerKey] = value.join(', ')
        }
      }

      // Responses that carry no body (HEAD, 204, 304) may still advertise the resource's full
      // size in content-length. That is metadata, not a payload, so it must not trip the cap —
      // otherwise a HEAD probe of a large file, or a conditional-GET 304, would fail spuriously.
      const isBodylessResponse =
        (requestOptions.method || 'GET').toUpperCase() === 'HEAD' ||
        statusCode === 204 ||
        statusCode === 304
      const contentLength = headersRecord['content-length']
      if (contentLength && !isBodylessResponse) {
        const parsedLength = Number.parseInt(contentLength, 10)
        if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
          cleanupAbort()
          res.destroy()
          req.destroy()
          if (isRetryableHttpStatus(statusCode)) {
            settledResolve({
              ok: false,
              status: statusCode,
              statusText: res.statusMessage || '',
              headers: new SecureFetchHeaders(headersRecord, setCookieArray),
              body: null,
              text: async () => '',
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            })
            return
          }
          settledReject(
            new PayloadSizeLimitError({
              label: 'response body',
              maxBytes: maxResponseBytes,
              observedBytes: parsedLength,
            })
          )
          return
        }
      }

      let totalBytes = 0
      const nodeRes = res
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeRes.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length
            if (totalBytes > maxResponseBytes) {
              cleanupAbort()
              controller.error(
                new PayloadSizeLimitError({
                  label: 'response body',
                  maxBytes: maxResponseBytes,
                  observedBytes: totalBytes,
                })
              )
              nodeRes.destroy()
              return
            }
            controller.enqueue(new Uint8Array(chunk))
          })
          nodeRes.on('end', () => {
            cleanupAbort()
            controller.close()
          })
          nodeRes.on('error', (err) => {
            cleanupAbort()
            controller.error(err)
          })
        },
        cancel() {
          cleanupAbort()
          nodeRes.destroy()
        },
      })

      let bodyBufferPromise: Promise<Buffer> | null = null
      function readBodyAsBuffer(): Promise<Buffer> {
        if (!bodyBufferPromise) {
          bodyBufferPromise = (async () => {
            const reader = body.getReader()
            const buffers: Uint8Array[] = []
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) buffers.push(value)
            }
            return Buffer.concat(buffers.map((b) => Buffer.from(b)))
          })()
        }
        return bodyBufferPromise
      }

      settledResolve({
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: res.statusMessage || '',
        headers: new SecureFetchHeaders(headersRecord, setCookieArray),
        body,
        text: async () => (await readBodyAsBuffer()).toString('utf-8'),
        json: async () => JSON.parse((await readBodyAsBuffer()).toString('utf-8')),
        arrayBuffer: async () => {
          const buf = await readBodyAsBuffer()
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        },
      })
    })

    let onAbort: (() => void) | null = null
    const cleanupAbort = () => {
      if (onAbort && options.signal) {
        options.signal.removeEventListener('abort', onAbort)
        onAbort = null
      }
    }
    const settledResolve: typeof resolve = (value) => {
      resolve(value)
    }
    const settledReject: typeof reject = (reason) => {
      cleanupAbort()
      reject(reason)
    }

    req.on('error', (error) => {
      settledReject(error)
    })

    req.on('timeout', () => {
      req.destroy()
      settledReject(new Error(`Request timed out after ${requestOptions.timeout}ms`))
    })

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy()
        settledReject(options.signal.reason ?? new Error('Aborted'))
        return
      }
      onAbort = () => {
        req.destroy()
        settledReject(options.signal?.reason ?? new Error('Aborted'))
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

/**
 * Validates a URL and performs a secure fetch with DNS pinning in one call.
 * Combines validateUrlWithDNS and secureFetchWithPinnedIP for convenience.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options, including the required egress `profile`
 * @param paramName - Name of the parameter for error messages (default: 'url')
 * @returns SecureFetchResponse
 * @throws Error if URL validation fails
 */
export async function secureFetchWithValidation(
  url: string,
  options: SecureFetchOptions,
  paramName = 'url'
): Promise<SecureFetchResponse> {
  const validation = await validateUrlWithDNS(url, paramName, options.profile)
  if (!validation.isValid) {
    throw new Error(validation.error)
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP, options)
}
