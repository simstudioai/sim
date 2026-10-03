/**
 * Client attribution: which official Sim client sent a request.
 *
 * Every first-party client declares itself with one header, `X-Sim-Client-Info`,
 * whose value is a list of `name/version` product tokens in the `User-Agent`
 * grammar of RFC 9110 §10.1.5, separated by `;` the way Supabase's
 * `X-Client-Info` and Google's `x-goog-api-client` are. A custom header rather
 * than `User-Agent` alone because a browser and an Electron renderer cannot set
 * `User-Agent`, so a single header every client can send is the only channel
 * that gives the server one place to look.
 *
 * ```text
 * X-Sim-Client-Info: cli/2.1.2; node/22.14.0; os/darwin; arch/arm64; agent/claude-code
 * X-Sim-Client-Info: desktop/1.4.2; electron/43.5.0; os/darwin; arch/arm64
 * X-Sim-Client-Info: web
 * ```
 *
 * The first token names the surface and, optionally, its version. The tokens
 * after it are keyed by name: `os`, `arch` and `agent` are reserved, and the
 * first unreserved one is the runtime. Order among the trailing tokens does
 * not matter, and unknown tokens are ignored so a newer client can add one
 * without breaking an older server.
 *
 * Attribution is analytics and log metadata only. It is caller-controlled and
 * is never an authorization input.
 */

export const CLIENT_INFO_HEADER = 'x-sim-client-info'

/**
 * The official Sim clients, as they name themselves on the wire. `mcp` is the
 * Sim MCP server, which declares itself on each v2 request it dispatches.
 */
export const SIM_SURFACES = ['web', 'desktop', 'cli', 'sdk-js', 'sdk-python', 'mcp'] as const

export type SimSurface = (typeof SIM_SURFACES)[number]

export interface ClientInfo {
  surface: SimSurface
  /** The client's own version, absent when the client is not versioned (the web app). */
  version?: string
  /** The runtime the client executes in, such as `node`, `electron`, or `python`. */
  runtime?: { name: string; version: string }
  /** Operating system and CPU architecture, in the names the runtime reports. */
  os?: string
  arch?: string
  /**
   * The AI coding agent driving the client (`claude-code`, `codex`, `cursor`,
   * …), when one could be detected. Detection lives with the CLI, the only
   * client that runs inside an agent's shell; the server carries the value
   * through. An open token rather than a closed list because new agents appear
   * faster than a server can be redeployed to know their names.
   */
  agent?: string
}

/**
 * The surfaces the server assigns to work no official client declared, so every
 * request and run is attributed to something rather than left blank:
 *
 * - `api`: direct API traffic, authenticated by a customer's credential.
 * - `internal`: Sim's own services calling each other, authenticated by a
 *   service credential.
 * - `webhook`, `schedule`: a run a trigger started rather than a client.
 * - `unknown`: none of the above, such as an unauthenticated webhook delivery.
 */
export const UNDECLARED_SURFACES = ['api', 'internal', 'webhook', 'schedule', 'unknown'] as const

export type UndeclaredSurface = (typeof UNDECLARED_SURFACES)[number]

/** Every surface a request or run can be attributed to. */
export type RequestSurface = SimSurface | UndeclaredSurface

/** How the server established a request's client. */
export type ClientInfoSource =
  | 'header'
  | 'user_agent'
  | 'fetch_metadata'
  | 'credential'
  | 'trigger'
  | 'unidentified'

export interface ResolvedClientInfo extends Omit<ClientInfo, 'surface'> {
  surface: RequestSurface
  source: ClientInfoSource
  /**
   * The product an undeclared client names first in its `User-Agent`
   * (`python-requests`, `curl`, `node`, or `browser` for any browser), in the
   * sense of OpenTelemetry's `user_agent.name`. Present only when the client
   * did not declare itself, since a declared client already says what it is.
   */
  name?: string
}

/** Bounds a caller-controlled header before it is parsed or logged. */
const MAX_HEADER_LENGTH = 256

/** RFC 9110 `token` characters minus the delimiters this header reserves. */
const TOKEN_PATTERN = /^[A-Za-z0-9._+-]+$/

/** Trailing token names with a fixed meaning; anything else is the runtime. */
const OS_KEY = 'os'
const ARCH_KEY = 'arch'
const AGENT_KEY = 'agent'

/** The `User-Agent` older CLI releases sent before the header existed. */
const LEGACY_CLI_USER_AGENT = /^sim-cli\/([A-Za-z0-9._+-]+)/

/** The header browsers attach to every request and non-browser clients never do. */
const FETCH_METADATA_HEADER = 'sec-fetch-mode'

/** The leading product name of a `User-Agent`, bounded so a hostile value stays cheap to read. */
const USER_AGENT_PRODUCT = /^([A-Za-z0-9._+-]{1,64})(?:[/\s]|$)/

/** The product every browser, and many libraries imitating one, names first. */
const BROWSER_PRODUCT = 'mozilla'

const SURFACE_SET: ReadonlySet<string> = new Set(SIM_SURFACES)

function isSurface(value: string): value is SimSurface {
  return SURFACE_SET.has(value)
}

function isToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

function product(name: string, version?: string): string {
  if (!isToken(name)) throw new Error(`Client info token name is not a valid token: ${name}`)
  if (version === undefined) return name
  if (!isToken(version))
    throw new Error(`Client info token version is not a valid token: ${version}`)
  return `${name}/${version}`
}

/**
 * Renders the `X-Sim-Client-Info` value a client sends.
 *
 * Throws on a value that is not an RFC 9110 token, because every field comes
 * from the client's own build or runtime constants and a bad one is a bug in
 * the client, not input to tolerate.
 */
export function formatClientInfo(info: ClientInfo): string {
  const tokens = [product(info.surface, info.version)]
  if (info.runtime) tokens.push(product(info.runtime.name, info.runtime.version))
  if (info.os) tokens.push(product(OS_KEY, info.os))
  if (info.arch) tokens.push(product(ARCH_KEY, info.arch))
  if (info.agent) tokens.push(product(AGENT_KEY, info.agent))
  return tokens.join('; ')
}

function splitProduct(token: string): { name: string; version?: string } | undefined {
  const slash = token.indexOf('/')
  const name = slash === -1 ? token : token.slice(0, slash)
  const version = slash === -1 ? undefined : token.slice(slash + 1)
  if (!isToken(name)) return undefined
  if (version !== undefined && !isToken(version)) return undefined
  return { name, version }
}

/**
 * Parses an `X-Sim-Client-Info` value.
 *
 * Returns `undefined` for anything that does not name a known surface, so an
 * unrecognised or malformed header reads as "unattributed" rather than as a
 * client that does not exist. Trailing tokens are tolerant: a malformed or
 * unknown one is skipped, never fatal, because a client may legitimately be
 * newer than the server reading it.
 */
export function parseClientInfo(value: string | null | undefined): ClientInfo | undefined {
  if (!value || value.length > MAX_HEADER_LENGTH) return undefined

  const tokens = value.split(';').map((token) => token.trim())
  const first = tokens[0] ? splitProduct(tokens[0]) : undefined
  if (!first || !isSurface(first.name)) return undefined

  const info: ClientInfo = { surface: first.name }
  if (first.version !== undefined) info.version = first.version

  for (const token of tokens.slice(1)) {
    if (token === '') continue
    const parsed = splitProduct(token)
    if (!parsed || parsed.version === undefined) continue

    if (parsed.name === OS_KEY) {
      info.os ??= parsed.version
    } else if (parsed.name === ARCH_KEY) {
      info.arch ??= parsed.version
    } else if (parsed.name === AGENT_KEY) {
      info.agent ??= parsed.version
    } else {
      info.runtime ??= { name: parsed.name, version: parsed.version }
    }
  }

  return info
}

/** The one method every request abstraction exposes, so a minimal test double qualifies. */
export interface HeaderReader {
  get(name: string): string | null
}

export interface ResolveClientInfoOptions {
  /**
   * Whether the request carries external API credentials (an API key or a
   * bearer token). Decided by the caller, which owns the credential header
   * names, so this module never has to know them.
   */
  hasExternalCredentials: boolean
}

/**
 * Establishes which client sent a request, from the strongest signal available.
 *
 * 1. `X-Sim-Client-Info`, when a client declared itself.
 * 2. The `User-Agent` of CLI releases that predate the header.
 * 3. Fetch Metadata. Browsers stamp `Sec-Fetch-*` on every request and nothing
 *    else does, so a browser request that carries no external credentials can
 *    only have come from a page Sim served — the web app, or a public surface
 *    such as a shared chat. A browser request that does carry an API key is a
 *    third-party integration, and falls through to the credential. The web app
 *    declares itself on its contract-bound calls; this covers the raw-`fetch`
 *    exceptions and stale bundles that do not.
 *
 * 4. Anything else is `unknown` until it authenticates, when
 *    {@link attributeUndeclaredClient} refines it by the credential it used.
 *    Headers alone cannot separate a customer's API key from one of Sim's own
 *    services, so the refinement waits for the credential to verify.
 *
 * An undeclared client records its `User-Agent` product name, so it still says
 * which library or tool sent it.
 */
export function resolveClientInfo(
  headers: HeaderReader,
  options: ResolveClientInfoOptions
): ResolvedClientInfo {
  const declared = parseClientInfo(headers.get(CLIENT_INFO_HEADER))
  if (declared) return { ...declared, source: 'header' }

  const userAgent = headers.get('user-agent') ?? ''
  const legacyCli = LEGACY_CLI_USER_AGENT.exec(userAgent)
  if (legacyCli) return { surface: 'cli', version: legacyCli[1], source: 'user_agent' }

  if (headers.get(FETCH_METADATA_HEADER) !== null && !options.hasExternalCredentials) {
    return { surface: 'web', source: 'fetch_metadata' }
  }

  const name = userAgentName(userAgent)
  return { surface: 'unknown', source: 'unidentified', ...(name ? { name } : {}) }
}

/** Auth kinds only Sim's own services hold: the executor, Copilot, and system jobs. */
const INTERNAL_AUTH_KINDS: ReadonlySet<string> = new Set([
  'internal_jwt',
  'delegated',
  'organization_delegated',
  'system',
])

/**
 * Refines an undeclared client by the credential its request authenticated
 * with: a customer's credential (an API key, an OAuth token, a SCIM or Slack
 * connection) makes it `api`, a Sim service credential makes it `internal`. A
 * session stays `unknown`, since a cookie without browser headers says nothing
 * about the client. A client that identified itself is returned unchanged, and
 * so is one a trigger started.
 */
export function attributeUndeclaredClient(
  client: ResolvedClientInfo,
  authKind: string
): ResolvedClientInfo {
  if (client.source !== 'unidentified' && client.source !== 'credential') return client
  if (authKind === 'session') return { ...client, surface: 'unknown', source: 'unidentified' }
  const surface = INTERNAL_AUTH_KINDS.has(authKind) ? 'internal' : 'api'
  return { ...client, surface, source: 'credential' }
}

/**
 * The first product a `User-Agent` names, lowercased so one library groups as
 * one value, with every browser collapsed to `browser` since they all claim to
 * be Mozilla.
 */
function userAgentName(userAgent: string): string | undefined {
  const product = USER_AGENT_PRODUCT.exec(userAgent)?.[1]?.toLowerCase()
  if (!product) return undefined
  return product === BROWSER_PRODUCT ? 'browser' : product
}
