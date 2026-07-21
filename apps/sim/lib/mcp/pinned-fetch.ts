import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createLogger } from '@sim/logger'
import type { Agent } from 'undici'
import { createPinnedFetchWithDispatcher } from '@/lib/core/security/input-validation.server'
import { validateMcpServerSsrf } from '@/lib/mcp/domain-check'
import { McpError } from '@/lib/mcp/types'

const logger = createLogger('McpOauthFetch')

/** Pinned fetch for the live MCP transport, plus a handle to release its sockets. */
export interface PinnedMcpFetch {
  fetch: typeof fetch
  /** Tears down the Agent's pooled sockets; call when the MCP client disconnects. */
  close: () => Promise<void>
}

/**
 * Pinned fetch for the long-lived MCP transport (one Agent reused per connection).
 *
 * Runs HTTP/1.1: we do not opt into undici's experimental `allowH2`, whose h2 path stalls
 * with headers-but-no-body on reused POST sessions (nodejs/undici #2311, #3433, #4143) —
 * the streamable-HTTP `initialize` hang behind a CDN. Both official MCP SDKs use h1.1, and
 * the transport has no concurrency to gain from h2. `close` tears down pooled sockets
 * (incl. the SSE connection) on disconnect; IP-pinning is protocol-independent.
 */
export function createPinnedMcpFetch(resolvedIP: string): PinnedMcpFetch {
  const { fetch: pinnedFetch, dispatcher } = createPinnedFetchWithDispatcher(resolvedIP)
  return { fetch: pinnedFetch, close: () => dispatcher.destroy() }
}

/**
 * Per-request deadline for guarded OAuth / RFC 7009 legs. The MCP SDK sets no timeout on
 * these (only its JSON-RPC layer gets one) and undici's default is 5 minutes, so an
 * unresponsive auth server would hang the flow — and the browser waiting on `/oauth/start`.
 * 30s mirrors `MCP_CLIENT_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT`.
 */
const OAUTH_FETCH_TIMEOUT_MS = 30_000

/**
 * DoS backstop for a guarded OAuth response body (real ones are <1 KB): stops a malicious
 * auth server — reached via attacker-controllable metadata URLs — from streaming a huge
 * body within the deadline. undici rejects with `UND_ERR_RES_EXCEEDED_MAX_SIZE` past it.
 */
const MAX_OAUTH_RESPONSE_BYTES = 1_048_576

/** True for undici's response-too-large rejection, however `fetch` wraps it. */
function isResponseTooLarge(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null
  return (
    e?.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE' ||
    e?.cause?.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE'
  )
}

/**
 * Bounds `promise` by `signal`, rejecting with its reason on abort — used to hold SSRF
 * validation, the request, and the body read inside the deadline. Attaches a rejection
 * handler on both paths so a settlement arriving after the deadline can't leak as unhandled.
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
 * Reads a guarded OAuth response under the deadline and returns a detached in-memory copy.
 * The SDK reads these bodies lazily — after our fetch resolves, with no timeout of its own
 * — so buffering here is what keeps the body read inside `signal`; undici's `bodyTimeout`
 * measures only idle gaps between chunks, not a stalled body. Bodies are always small JSON.
 */
async function bufferUnderDeadline(response: Response, signal: AbortSignal): Promise<Response> {
  const body = await withDeadline(response.arrayBuffer(), signal)
  const headers = new Headers(response.headers)
  // Detached + decoded: drop framing headers that would misdescribe the in-memory copy.
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
 * Hands a streaming guarded response (the auth-type probe's `initialize`) back live rather
 * than buffering it — buffering would stall on a server that holds the stream open. Tears
 * the per-request Agent down once the stream ends, the caller cancels, or the deadline
 * aborts; the `tee` keeps the returned body readable meanwhile.
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
      // Drain to end-of-stream so the Agent can be torn down once the reply completes.
      while (!(await reader.read()).done) {}
    } catch {
      // Aborted or errored — teardown still runs in `finally`.
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
 * registration, token exchange/refresh, RFC 7009 revocation). Each hop's URL comes from
 * attacker-controllable authorization-server metadata, so every request is re-validated
 * against the SSRF policy and pinned to the resolved IP.
 *
 * The SDK provides none of the safety itself (no timeout on OAuth legs, lazy body reads),
 * so the guard owns it: the `timeoutMs` deadline covers validation + request + the buffered
 * body read; the per-request pinned Agent is `destroy()`ed on every path; and the returned
 * `Response` is a detached in-memory copy. Only our own deadline is relabeled to `McpError`.
 *
 * @param timeoutMs Per-request deadline in ms (defaults to 30s; override for tests).
 * @throws McpSsrfError if a request URL resolves to a blocked IP address
 * @throws McpError if a request exceeds `timeoutMs`
 */
export function createSsrfGuardedMcpFetch(timeoutMs: number = OAUTH_FETCH_TIMEOUT_MS): FetchLike {
  return (async (url, init) => {
    const target = typeof url === 'string' ? url : url.href
    const host = URL.canParse(target) ? new URL(target).host : target
    const startedAt = Date.now()
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    // Bound every phase — validation, request, body read — by the deadline + caller signal.
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    // Per-request Agent must be torn down (finally): a one-shot leg never reuses its socket.
    let dispatcher: Agent | undefined
    try {
      logger.info('OAuth guarded fetch: validating', { host })
      const resolvedIP = await withDeadline(validateMcpServerSsrf(target), signal)
      logger.info('OAuth guarded fetch: requesting', { host, pinned: Boolean(resolvedIP) })
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
      // The probe's `initialize` can stream (text/event-stream); hand it back live so the
      // buffer doesn't drain/stall it. Every OAuth leg is single-shot JSON and is buffered.
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const streamed = releaseStreamOnSettle(response, dispatcher, signal)
        dispatcher = undefined // teardown ownership moved to releaseStreamOnSettle
        logger.info('OAuth guarded fetch: streaming response', {
          host,
          status: response.status,
          ms: Date.now() - startedAt,
        })
        return streamed
      }
      logger.info('OAuth guarded fetch: reading body', { host, status: response.status })
      const buffered = await bufferUnderDeadline(response, signal)
      logger.info('OAuth guarded fetch: done', {
        host,
        status: response.status,
        ms: Date.now() - startedAt,
      })
      return buffered
    } catch (error) {
      logger.warn('OAuth guarded fetch: failed', { host, ms: Date.now() - startedAt })
      // Relabel only our own deadline — by reason identity, not signal state (which may
      // abort independently just after the deadline).
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
      // destroy() not close() so a hung leg can't stall teardown; frees the pooled socket.
      await dispatcher?.destroy().catch(() => {})
    }
  }) satisfies FetchLike
}
