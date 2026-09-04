import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { oauthIssuerForEndpoint, redact } from '../config/profile'
import { buildUrl, REDIRECT_STATUSES, SimApiError } from '../http/client'
import { USER_AGENT } from '../version'

/**
 * The OAuth half of `sim login`: authorization code + PKCE with a loopback
 * redirect (RFC 8252), the flow gcloud, the AWS CLI, Wrangler and Railway use.
 *
 * The CLI is a public client — there is no secret to keep — so PKCE is what
 * binds the code to this process: the browser carries only the SHA-256 of a
 * verifier that never leaves memory, and the token endpoint refuses a code
 * presented without it. `state` guards the loopback listener against a stray
 * or forged redirect, and the listener binds the loopback interface only, for
 * the life of one login.
 *
 * The result is a short-lived access token and a rotating refresh token, both
 * revocable from Settings → Authorized apps, instead of the permanent API key
 * the pairing-code handoff in `device-flow.ts` mints. That handoff remains the
 * path for a terminal whose browser cannot reach it (SSH, containers).
 */

/** The client id migration `0322_oauth_provider` seeds; a public client, no secret. */
export const OAUTH_CLIENT_ID = 'sim-cli'

/**
 * Everything the CLI does, and nothing more: renew itself, and read and change
 * workspace resources.
 *
 * The identity scopes (`openid`, `profile`, `email`) are deliberately absent.
 * Sim issues opaque access tokens, and the provider returns no `id_token` at
 * all to a public client with no secret — so `openid` could never be honoured
 * for this client, and the CLI reads no profile or email either. Asking for
 * them would put three permissions on the consent card that this app does not
 * use and, for `openid`, structurally cannot.
 */
export const OAUTH_SCOPES_FULL = ['offline_access', 'api:read', 'api:write'] as const

/** `--read-only`: a token that can inspect but never change anything. */
export const OAUTH_SCOPES_READ_ONLY = ['offline_access', 'api:read'] as const

const AUTHORIZE_PATH = '/api/auth/oauth2/authorize'
const TOKEN_PATH = '/api/auth/oauth2/token'
const REVOKE_PATH = '/api/auth/oauth2/revoke'
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server'
const CALLBACK_PATH = '/callback'

/**
 * How long the browser leg may take. Railway and Wrangler use the same window;
 * long enough to sign up and read the consent page, short enough that a
 * forgotten terminal does not keep a listener open all afternoon.
 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** How long a discovery, revocation, or code exchange may take. */
const REQUEST_TIMEOUT_MS = 10 * 1000

/**
 * Refuses to run the OAuth flow over cleartext.
 *
 * The code, the verifier, and both tokens cross this connection. An API key
 * over `http` earns a warning because the user typed the endpoint and may know
 * something we do not; a login is different, because the flow itself is what
 * would leak, and because a tampered discovery response silently downgrades
 * `sim login` to the pairing-code handoff — which mints a permanent key.
 * Loopback is exempt: it never leaves the machine.
 */
export function requireSecureEndpoint(endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !loopback) {
    throw new SimApiError(
      `Refusing to sign in to ${url.host} over http: the sign-in would send your tokens in the clear. Use https. There is no cleartext fallback — the pairing-code handoff would send a permanent API key over the same connection.`,
      0
    )
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds at which `accessToken` stops working. */
  expiresAt: number
  scope: string
}

/** A refusal from the token endpoint, carrying the RFC 6749 error code. */
export class OAuthTokenError extends SimApiError {
  constructor(
    readonly oauthError: string,
    description: string | undefined,
    status: number
  ) {
    super(description ?? `Authorization server refused the request (${oauthError})`, status)
    this.name = 'OAuthTokenError'
  }
}

export interface Pkce {
  verifier: string
  challenge: string
  state: string
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

/** A fresh verifier (43 chars, 256 bits), its S256 challenge, and a `state` nonce. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(32))
  return {
    verifier,
    challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    state: base64url(randomBytes(16)),
  }
}

export function buildRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`
}

export function buildAuthorizeUrl(
  endpoint: string,
  args: { redirectUri: string; scopes: readonly string[]; pkce: Pkce }
): string {
  return buildUrl(endpoint, AUTHORIZE_PATH, {
    client_id: OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    scope: args.scopes.join(' '),
    code_challenge: args.pkce.challenge,
    code_challenge_method: 'S256',
    state: args.pkce.state,
  })
}

export type OAuthProviderStatus = 'available' | 'unavailable' | 'unreachable'

/**
 * Whether the endpoint is an OAuth authorization server, from the RFC 8414
 * discovery document. A 404 is a definite "no" — an older Sim, or one with the
 * provider switched off — and sends login to the pairing-code handoff; a
 * transport failure is reported as such so a typo'd endpoint is not mistaken
 * for a server that lacks the feature.
 */
export async function discoverOAuthProvider(endpoint: string): Promise<OAuthProviderStatus> {
  let response: Response
  try {
    response = await fetch(buildUrl(endpoint, DISCOVERY_PATH), {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return 'unreachable'
  }
  /**
   * Only a definite "no" counts as unavailable. A 5xx or a redirect means the
   * question was not answered — a proxy mid-deploy, a captive portal — and
   * calling that "no OAuth here" would quietly hand the user a permanent API
   * key from the handoff on a server that does support signing in.
   */
  if (response.status === 404) return 'unavailable'
  if (!response.ok || REDIRECT_STATUSES.has(response.status)) return 'unreachable'
  try {
    const metadata = (await response.json()) as { issuer?: unknown; token_endpoint?: unknown }
    const expectedIssuer = oauthIssuerForEndpoint(endpoint)
    const expectedTokenEndpoint = buildUrl(endpoint, TOKEN_PATH)
    return metadata.issuer === expectedIssuer && metadata.token_endpoint === expectedTokenEndpoint
      ? 'available'
      : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
  token_type?: unknown
  error?: unknown
  error_description?: unknown
}

async function postToken(
  endpoint: string,
  path: string,
  form: Record<string, string>,
  signal?: AbortSignal
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(buildUrl(endpoint, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams(form).toString(),
      signal,
      redirect: 'manual',
    })
  } catch (cause) {
    throw new SimApiError(`Could not reach ${endpoint}: ${(cause as Error).message}`, 0)
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    throw new SimApiError(
      `${endpoint} redirected the token request. The CLI does not follow redirects, because a redirect drops the request body and would carry the login secret to another origin. Check the endpoint.`,
      response.status
    )
  }
  return response
}

async function readTokens(
  response: Response,
  issuedAt: number,
  expectedScopes?: readonly string[]
): Promise<OAuthTokens> {
  const raw = await response.text()
  let body: TokenResponse
  try {
    body = JSON.parse(raw) as TokenResponse
  } catch {
    throw new SimApiError(
      `The authorization server answered HTTP ${response.status} with a non-JSON body.`,
      response.status
    )
  }
  if (!response.ok || typeof body.error === 'string') {
    throw new OAuthTokenError(
      typeof body.error === 'string' ? body.error : 'server_error',
      // The description is whatever the endpoint sent, so it goes through the
      // same redaction every other quoted remote value does: a value carrying
      // control characters would otherwise write its own lines to the terminal.
      typeof body.error_description === 'string' ? redact(body.error_description) : undefined,
      response.status
    )
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new SimApiError(
      'The authorization server did not return both an access token and a refresh token. Nothing was stored.',
      response.status
    )
  }
  if (
    body.token_type !== undefined &&
    (typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer')
  ) {
    throw new SimApiError(
      'The authorization server returned an unsupported token type.',
      response.status
    )
  }
  if (
    body.expires_in !== undefined &&
    (typeof body.expires_in !== 'number' ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0)
  ) {
    throw new SimApiError(
      'The authorization server returned an invalid access-token lifetime.',
      response.status
    )
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600
  const scope =
    typeof body.scope === 'string' ? body.scope : expectedScopes ? expectedScopes.join(' ') : ''
  if (expectedScopes) {
    const granted = new Set(scope.split(' ').filter(Boolean))
    const unexpected = [...granted].filter((item) => !expectedScopes.includes(item))
    if (!granted.has('offline_access') || !granted.has('api:read') || unexpected.length > 0) {
      throw new SimApiError(
        'The authorization server returned scopes that do not match the login request. Nothing was stored.',
        response.status
      )
    }
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: issuedAt + expiresIn * 1000,
    scope,
  }
}

export function grantsWriteAccess(scope: string): boolean {
  return scope.split(' ').includes('api:write')
}

/** Redeems an authorization code with its PKCE verifier. */
export async function exchangeCode(
  endpoint: string,
  args: { code: string; redirectUri: string; verifier: string; requestedScopes: readonly string[] },
  signal?: AbortSignal
): Promise<OAuthTokens> {
  const issuedAt = Date.now()
  const response = await postToken(
    endpoint,
    TOKEN_PATH,
    {
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    },
    signal
  )
  return readTokens(response, issuedAt, args.requestedScopes)
}

/**
 * Trades a refresh token for a new pair. The server rotates: the token used
 * here is dead afterwards, and presenting it again invalidates every token the
 * CLI holds for this account — which is why callers serialize refreshes
 * through the credentials lock before reaching this.
 */
export async function refreshTokens(
  endpoint: string,
  refreshToken: string,
  expectedScopes?: readonly string[],
  signal?: AbortSignal
): Promise<OAuthTokens> {
  const issuedAt = Date.now()
  const response = await postToken(
    endpoint,
    TOKEN_PATH,
    { grant_type: 'refresh_token', client_id: OAUTH_CLIENT_ID, refresh_token: refreshToken },
    signal
  )
  return readTokens(response, issuedAt, expectedScopes)
}

/**
 * Revokes a refresh token server-side, which also kills the access tokens it
 * issued. RFC 7009 answers 200 for an unknown token, so this only fails when
 * the server cannot be reached or refuses the client.
 */
export async function revokeToken(endpoint: string, token: string): Promise<void> {
  const response = await postToken(
    endpoint,
    REVOKE_PATH,
    { token, token_type_hint: 'refresh_token', client_id: OAUTH_CLIENT_ID },
    AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  )
  if (!response.ok) {
    throw new SimApiError(
      `The authorization server refused to revoke the session (HTTP ${response.status}).`,
      response.status
    )
  }
}

const PAGE_STYLE =
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#111;background:#fff'

function callbackPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="${PAGE_STYLE}"><main style="text-align:center;max-width:28rem;padding:2rem"><h1 style="font-weight:400;font-size:1.5rem;margin:0 0 .5rem">${title}</h1><p style="margin:0;color:#666">${body}</p></main></body></html>`
}

interface LoopbackResult {
  code: string
}

/**
 * Listens on the loopback interface for one redirect and hands back its code.
 *
 * `127.0.0.1` rather than `localhost`, as RFC 8252 §7.3 recommends: the name
 * can resolve to a non-loopback interface, and the server registers the IP
 * literal. Port 0 lets the OS pick, which the server accepts for any loopback
 * port; `--callback-port` pins it for a container whose port must be forwarded.
 */
function listenForCallback(
  server: Server,
  expectedState: string,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<LoopbackResult> {
  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false
    const finish = (outcome: { ok: true; value: LoopbackResult } | { ok: false; error: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.close()
      // `close()` only stops accepting. The browser sends `Connection:
      // keep-alive`, so without this the socket holds the event loop open for
      // Node's 5s `keepAliveTimeout` and `sim login` sits there, already
      // finished, after printing its success line.
      server.closeAllConnections()
      if (outcome.ok) resolve(outcome.value)
      else reject(outcome.error)
    }
    const onAbort = () => finish({ ok: false, error: new SimApiError('Login cancelled.', 0) })
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: new SimApiError(
            `Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for the browser. Run sim login again, or use --browserless if this terminal's browser cannot reach it.`,
            0
          ),
        }),
      timeoutMs
    )
    signal?.addEventListener('abort', onAbort, { once: true })

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
        return
      }
      const error = url.searchParams.get('error')
      const state = url.searchParams.get('state')
      const code = url.searchParams.get('code')

      /**
       * Anything on the machine can reach a loopback port, so a request that
       * does not carry this login's `state` is answered and ignored rather
       * than ending the wait — otherwise any page the user has open could
       * cancel their sign-in by fetching the callback. The real browser still
       * arrives with the right `state`, or the timeout fires.
       */
      if (state !== expectedState) {
        response
          .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          .end(
            callbackPage(
              'Sign-in mismatch',
              'This response did not come from the sign-in this terminal started. Return to your terminal.'
            )
          )
        return
      }
      if (error || !code) {
        const description = url.searchParams.get('error_description') ?? undefined
        response
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(
            callbackPage('Sign-in cancelled', 'You can close this tab and return to your terminal.')
          )
        finish({
          ok: false,
          error:
            error === 'access_denied'
              ? new SimApiError('Sign-in was declined in the browser.', 0)
              : new SimApiError(
                  description
                    ? redact(description)
                    : `Sign-in failed (${redact(error ?? 'no code returned')}).`,
                  0
                ),
        })
        return
      }
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          callbackPage(
            'Authorization received',
            'Return to your terminal while Sim finishes signing you in.'
          )
        )
      finish({ ok: true, value: { code } })
    })
  })
}

export interface BrowserLoginOptions {
  scopes: readonly string[]
  /** Pin the loopback port, for a container that forwards a fixed one. */
  callbackPort?: number
  /** Called with the authorize URL once the listener is up, before waiting. */
  onAuthorizeUrl: (url: string) => void
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Runs the whole browser login: listener, authorize URL, callback, exchange.
 * Resolves with tokens only after the code has been redeemed, so a caller that
 * gets a result holds a working credential.
 */
export async function loginWithBrowser(
  endpoint: string,
  options: BrowserLoginOptions
): Promise<OAuthTokens> {
  requireSecureEndpoint(endpoint)

  const pkce = createPkce()
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', (cause) => {
      // The ordinary outcome of `--callback-port` naming a port that is taken
      // or privileged, so it is explained rather than thrown as a stack trace.
      reject(
        new SimApiError(
          `Could not listen on the sign-in callback port: ${cause.message}. Pick another --callback-port.`,
          0
        )
      )
    })
    server.listen(options.callbackPort ?? 0, '127.0.0.1', () => {
      server.removeAllListeners('error')
      resolve()
    })
  })

  const port = (server.address() as AddressInfo).port
  const redirectUri = buildRedirectUri(port)
  const callbackAbort = new AbortController()
  const callbackSignal = options.signal
    ? AbortSignal.any([options.signal, callbackAbort.signal])
    : callbackAbort.signal
  const pending = listenForCallback(
    server,
    pkce.state,
    callbackSignal,
    options.timeoutMs ?? LOGIN_TIMEOUT_MS
  )

  try {
    options.onAuthorizeUrl(
      buildAuthorizeUrl(endpoint, { redirectUri, scopes: options.scopes, pkce })
    )
  } catch (error) {
    callbackAbort.abort()
    await pending.catch(() => undefined)
    throw error
  }

  const { code } = await pending
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return exchangeCode(
    endpoint,
    { code, redirectUri, verifier: pkce.verifier, requestedScopes: options.scopes },
    options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  )
}

/**
 * Whether this terminal's browser is unlikely to reach a loopback listener on
 * this machine: an SSH session, or a Linux box with no display. The signals
 * Railway and Stripe use to auto-select their pairing flows; `--browserless`
 * forces it and `--callback-port` overrides the guess.
 */
export function isLikelyRemoteSession(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return true
  return platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY
}
