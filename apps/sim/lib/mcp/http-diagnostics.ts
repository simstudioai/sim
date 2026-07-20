import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createLogger } from '@sim/logger'
import { getMcpSafeErrorDiagnostics } from '@/lib/mcp/error-diagnostics'

const logger = createLogger('McpHttpDiag')

const MAX_LOGGED_CHUNKS = 40
const PREVIEW_CHARS = 500

/**
 * TEMPORARY diagnostic for the MCP OAuth + streamable-HTTP transport HTTP layer.
 * Enabled by default; set `MCP_HTTP_DIAGNOSTICS=false` to silence. Remove once the
 * Gauge `initialize` hang is root-caused.
 *
 * Secret-safety (the wrapped transport fetch also carries in-transport OAuth
 * refresh/registration, and every tool result):
 * - Request and OAuth response bodies are NEVER logged.
 * - The only response body streamed is the one whose REQUEST is an MCP `initialize`
 *   JSON-RPC call — which excludes token/refresh responses AND `tools/call` results
 *   (tool output can be PII/file contents/credentials). The `initialize` result is
 *   protocol metadata only (serverInfo, capabilities), no credentials.
 * - URLs are logged origin+path only; query strings (`?code=`, `?token=`, …) are
 *   redacted. Sensitive headers (authorization/cookie/www-authenticate) are omitted.
 */
function diagnosticsEnabled(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return false
  return process.env.MCP_HTTP_DIAGNOSTICS !== 'false'
}

/** Origin + path only — query values can carry `code`/`token`/`api_key`, so they're dropped. */
function safeUrl(input: string | URL | Request): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const u = new URL(raw)
    return u.search ? `${u.origin}${u.pathname}?<redacted>` : `${u.origin}${u.pathname}`
  } catch {
    return '<unparseable-url>'
  }
}

/**
 * True only when the request body is an MCP `initialize` JSON-RPC message. Used to
 * scope response-body logging to the initialize handshake and nothing else — token
 * requests (form-encoded) and tool calls (`method: 'tools/call'`) both fail this.
 */
function isInitializeRequest(body: unknown): boolean {
  if (typeof body !== 'string') return false
  try {
    return (JSON.parse(body) as { method?: unknown })?.method === 'initialize'
  } catch {
    return false
  }
}

/**
 * Wraps a `FetchLike` so every request/response in the MCP OAuth or transport flow is
 * logged with timing. Only the `initialize` response body is streamed (see secret-safety
 * note above) — that's the suspected hang.
 */
export function withMcpHttpDiagnostics(
  fetchFn: FetchLike,
  phase: 'oauth' | 'transport'
): FetchLike {
  if (!diagnosticsEnabled()) return fetchFn

  return async (input, init) => {
    const url = safeUrl(input as string | URL | Request)
    const method = init?.method ?? 'GET'
    const reqHeaders = new Headers((init?.headers as HeadersInit | undefined) ?? undefined)
    const startedAt = Date.now()

    logger.info('request', {
      phase,
      method,
      url,
      hasAuth: reqHeaders.has('authorization'),
      accept: reqHeaders.get('accept') ?? undefined,
    })

    let res: Response
    try {
      res = (await fetchFn(input, init)) as Response
    } catch (error) {
      logger.warn('fetch rejected', {
        phase,
        method,
        url,
        ms: Date.now() - startedAt,
        error: getMcpSafeErrorDiagnostics(error),
      })
      throw error
    }

    logger.info('response', {
      phase,
      method,
      url,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      mcpSessionId: res.headers.get('mcp-session-id') ? 'present' : 'absent',
      headerMs: Date.now() - startedAt,
    })

    // Stream-log ONLY the initialize handshake response — never OAuth bodies or tool results.
    if (phase !== 'transport' || !isInitializeRequest(init?.body) || !res.body) return res

    let logBranch: ReadableStream<Uint8Array>
    let passBranch: ReadableStream<Uint8Array>
    try {
      ;[logBranch, passBranch] = res.body.tee()
    } catch {
      return res
    }

    void (async () => {
      const reader = logBranch.getReader()
      const decoder = new TextDecoder()
      let chunks = 0
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            logger.info('initialize body complete', {
              url,
              chunks,
              bytes,
              ms: Date.now() - startedAt,
            })
            break
          }
          chunks += 1
          bytes += value.byteLength
          if (chunks <= MAX_LOGGED_CHUNKS) {
            logger.info('initialize body chunk', {
              url,
              chunk: chunks,
              size: value.byteLength,
              ms: Date.now() - startedAt,
              preview: decoder.decode(value, { stream: true }).slice(0, PREVIEW_CHARS),
            })
          }
        }
      } catch (error) {
        logger.warn('initialize body read error', {
          url,
          chunks,
          bytes,
          ms: Date.now() - startedAt,
          error: getMcpSafeErrorDiagnostics(error),
        })
      }
    })()

    return new Response(passBranch, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}
