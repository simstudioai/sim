import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Agent } from 'undici'
import { createPinnedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import { validateMcpServerSsrf } from '@/lib/mcp/domain-check'
import { McpError } from '@/lib/mcp/types'

/** Pinned fetch for the live MCP transport, plus a handle to release its sockets. */
export interface PinnedMcpFetch {
  /** Pinned fetch to hand to the MCP transport's `fetch` option. */
  fetch: typeof fetch
  /** Tears down the underlying Agent's pooled sockets; call when the MCP client disconnects. */
  close: () => Promise<void>
}

/**
 * Pinned fetch for the long-lived MCP transport, which reuses one Agent across a
 * connection's requests.
 *
 * The transport speaks **HTTP/1.1** (undici's default — we do not opt into `allowH2`).
 * Every stock MCP client does the same: the official SDK's `StreamableHTTPClientTransport`
 * calls global `fetch` (undici on h1.1) and never touches HTTP/2. h2's only real win is
 * multiplexing many concurrent requests over one socket, which the MCP transport — one
 * POST per JSON-RPC message plus a single long-lived SSE stream — never does, so it buys
 * nothing here. undici's h2 support is still marked experimental and has a documented
 * cluster of "response headers arrive, body DATA frames never do" stalls on POST bodies
 * over reused/coalesced sessions (nodejs/undici #2311, #3433, #4143). Behind a shared
 * egress IP fronted by a CDN, that stall is exactly what hung the streamable-HTTP
 * `initialize` (200 + `Mcp-Session-Id`, then an empty body until the SDK's 30s timeout).
 * h1.1 sidesteps that whole surface, and CDN fronts serve h1.1 anyway.
 *
 * Pinning is unaffected: the pinned lookup forces the socket to `resolvedIP` regardless of
 * protocol. The returned `close` binds Agent teardown to the transport lifecycle so pooled
 * keep-alive sockets (including the SSE connection) don't linger past disconnect.
 */
export function createPinnedMcpFetch(resolvedIP: string): PinnedMcpFetch {
  const { fetch: pinnedFetch, dispatcher } = createPinnedFetchWithDispatcher(resolvedIP)
  return { fetch: pinnedFetch, close: () => dispatcher.destroy() }
}

/**
 * Per-request deadline for guarded MCP OAuth / RFC 7009 revocation HTTP calls.
 *
 * The MCP SDK issues OAuth discovery, dynamic client registration, and token
 * exchange with a bare `fetch` and no `AbortSignal` — only the JSON-RPC message
 * layer gets the SDK's request timeout. Combined with undici's 5-minute default
 * headers/body timeouts, a slow or unresponsive authorization server leaves the
 * request (and the browser the user is waiting on during `/oauth/start`) pending
 * for minutes. Bounding each leg turns that into a fast, actionable failure. 30s
 * mirrors `MCP_CLIENT_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT` and leaves wide
 * headroom over a healthy server, which completes each leg in well under a second.
 */
const OAUTH_FETCH_TIMEOUT_MS = 30_000

/**
 * Cap on a guarded OAuth response body. Discovery/registration/token/refresh/revocation
 * replies are always well under 1 KB; this ceiling is purely a DoS backstop so a
 * malicious authorization server (reached via attacker-controllable metadata URLs)
 * can't stream a multi-GB body within the deadline and exhaust memory. undici rejects
 * with `UND_ERR_RES_EXCEEDED_MAX_SIZE` once the decoded body exceeds it.
 */
const MAX_OAUTH_RESPONSE_BYTES = 1_048_576

/** True for undici's response-too-large rejection, however it's wrapped by `fetch`. */
function isResponseTooLarge(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null
  return (
    e?.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE' ||
    e?.cause?.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE'
  )
}

/**
 * Bounds `promise` by the composed deadline/caller `signal`, rejecting with the signal's
 * reason if it aborts first. Holds every guarded phase inside the deadline — the
 * `dns.lookup`-based SSRF validation (which takes no signal of its own), the HTTP
 * request, and the response body read. Either path attaches a rejection handler to
 * `promise` (the pre-aborted `.catch`, or `.then(resolve, reject)`), so a settlement
 * arriving after the deadline has fired — once we've stopped awaiting it and are tearing
 * the request down — can't surface as an unhandled rejection. The abort listener is
 * removed once `promise` settles.
 */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/**
 * Reads a guarded OAuth response fully under the deadline, then returns a detached,
 * in-memory copy. The MCP SDK reads discovery/registration/token/refresh bodies
 * lazily — AFTER `auth()`'s injected fetch resolves — and applies no timeout of its
 * own, so returning the live response would let the body read escape every deadline
 * (the "Connecting… forever" hang). Buffering here brings the body read inside the
 * wall-clock `signal`: undici's `bodyTimeout` only measures idle gaps between chunks
 * and cannot bound a slow-drip or stalled body. These bodies are always small JSON.
 */
async function bufferUnderDeadline(response: Response, signal: AbortSignal): Promise<Response> {
  const body = await withDeadline(response.arrayBuffer(), signal)
  const headers = new Headers(response.headers)
  // The buffered copy is decoded and detached from the socket; drop framing headers
  // that would misdescribe it.
  headers.delete('content-encoding')
  headers.delete('content-length')
  const nullBody = response.status === 204 || response.status === 205 || response.status === 304
  return new Response(nullBody ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Hands a streaming guarded response back live instead of buffering it. The only
 * streaming reply a guarded call can see is the auth-type probe's `initialize`
 * (`text/event-stream`), and the probe classifies from headers alone — buffering it
 * would drain the stream or stall on a server that holds it open (misclassifying auth).
 * The per-request pinned Agent (if any) is torn down once the stream ends, the caller
 * cancels it, or the deadline aborts, so the socket is never stranded; the `tee` keeps
 * the returned body fully readable meanwhile. Teardown ownership moves here, out of the
 * caller's `finally`.
 */
function releaseStreamOnSettle(
  response: Response,
  dispatcher: Agent | undefined,
  signal: AbortSignal
): Response {
  if (!dispatcher || !response.body) {
    void dispatcher?.destroy().catch(() => {})
    return response
  }
  const [drain, passthrough] = response.body.tee()
  void (async () => {
    const reader = drain.getReader()
    const onAbort = () => void reader.cancel().catch(() => {})
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!(await reader.read()).done) {
        // Drain to end-of-stream so the Agent can be torn down once the reply completes.
      }
    } catch {
      // Aborted or errored — the teardown below still runs.
    } finally {
      signal.removeEventListener('abort', onAbort)
      void dispatcher.destroy().catch(() => {})
    }
  })()
  return new Response(passthrough, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Builds a `FetchLike` for one-shot MCP OAuth calls (discovery, dynamic client
 * registration, token exchange/refresh, RFC 7009 revocation). It validates every
 * outbound URL against the MCP SSRF policy before issuing it, then pins the
 * connection to the resolved IP. Unlike the live transport — where the server URL is
 * validated once up front — these hops follow URLs taken verbatim from
 * attacker-controllable authorization-server metadata (`authorization_servers`,
 * `token_endpoint`, `revocation_endpoint`, …), so each is re-validated and
 * private/reserved/loopback targets are rejected (honoring `ALLOWED_MCP_DOMAINS` and
 * self-hosted localhost rules).
 *
 * Three correctness guarantees, each of which the MCP SDK does NOT provide itself (it
 * sets no timeout on any OAuth leg and reads bodies lazily):
 * - **Bounded end-to-end.** The `timeoutMs` deadline (`AbortSignal.timeout`) composed
 *   with any caller signal covers SSRF validation, the request, AND the response body
 *   read — the body is buffered here so the SDK's later read can't outlive the
 *   deadline. Only our own deadline is relabeled to an `McpError`; a caller abort or
 *   any other failure propagates unchanged.
 * - **No leaked sockets.** The per-request pinned Agent is `destroy()`ed on every path,
 *   releasing the keep-alive socket a one-shot flow would otherwise strand.
 * - **Detached response.** The returned `Response` is an in-memory copy, safe to read
 *   after the underlying socket is gone.
 *
 * A stalled DNS resolution still runs to completion in the background, but its result
 * is discarded.
 *
 * @param timeoutMs Per-request deadline in ms (defaults to 30s; override for tests).
 * @throws McpSsrfError if a request URL resolves to a blocked IP address
 * @throws McpError if a request exceeds `timeoutMs`
 */
export function createSsrfGuardedMcpFetch(timeoutMs: number = OAUTH_FETCH_TIMEOUT_MS): FetchLike {
  return (async (url, init) => {
    const target = typeof url === 'string' ? url : url.href
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    // Compose deadline + caller signal up front so every phase — SSRF validation, the
    // HTTP request, and the body read — is bounded by the deadline and caller cancellation.
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    // The per-request pinned Agent MUST be torn down: it holds a keep-alive socket the
    // one-shot OAuth flow never reuses, so leaving it open leaks a socket per leg.
    let dispatcher: Agent | undefined
    try {
      const resolvedIP = await withDeadline(validateMcpServerSsrf(target), signal)
      let response: Response
      if (resolvedIP) {
        const pinned = createPinnedFetchWithDispatcher(resolvedIP, {
          maxResponseSize: MAX_OAUTH_RESPONSE_BYTES,
        })
        dispatcher = pinned.dispatcher
        response = await withDeadline(pinned.fetch(url, { ...init, signal }), signal)
      } else {
        // No pin (self-hosted allowlist) — global fetch over the shared dispatcher.
        response = await withDeadline(globalThis.fetch(url, { ...init, signal }), signal)
      }
      // A `text/event-stream` reply is the auth-type probe's `initialize` (the only
      // streaming case a guarded call sees); hand it back live with its own teardown so
      // the caller reads headers without the buffer draining/stalling the stream. Every
      // OAuth leg is single-shot JSON and falls through to be buffered and torn down.
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const streamed = releaseStreamOnSettle(response, dispatcher, signal)
        dispatcher = undefined // teardown ownership handed to releaseStreamOnSettle
        return streamed
      }
      return await bufferUnderDeadline(response, signal)
    } catch (error) {
      const host = URL.canParse(target) ? new URL(target).host : target
      // Relabel only when our own deadline is what fired — identified by the
      // rejection reason's identity, not init.signal's state (which may abort
      // independently just after the deadline).
      if (timeoutSignal.aborted && error === timeoutSignal.reason) {
        throw new McpError(`MCP authorization request to ${host} timed out after ${timeoutMs}ms`)
      }
      if (isResponseTooLarge(error)) {
        throw new McpError(
          `MCP authorization response from ${host} exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`
        )
      }
      throw error
    } finally {
      // Destroy (not close) so a hung leg can't make teardown itself hang; this releases
      // the pooled keep-alive socket the per-request Agent would otherwise strand.
      await dispatcher?.destroy().catch(() => {})
    }
  }) satisfies FetchLike
}
