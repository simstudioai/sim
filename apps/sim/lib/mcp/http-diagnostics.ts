import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createLogger } from '@sim/logger'
import { sanitizeForLogging } from '@/lib/core/security/redaction'
import { getMcpSafeErrorDiagnostics } from '@/lib/mcp/error-diagnostics'

const logger = createLogger('McpHttpDiag')

const MAX_LOGGED_CHUNKS = 40
const PREVIEW_CHARS = 500

/**
 * TEMPORARY diagnostic for the MCP OAuth + streamable-HTTP transport HTTP layer.
 * Enabled by default; set `MCP_HTTP_DIAGNOSTICS=false` to silence. Remove once the
 * Gauge `initialize` hang is root-caused.
 *
 * Safety: request bodies and the OAuth token-response body carry the authorization
 * code / access / refresh tokens, so they are NEVER logged. Only the *transport*
 * response body — MCP JSON-RPC protocol messages, which contain no credentials — is
 * streamed and logged, and every logged value passes through `sanitizeForLogging`.
 */
function diagnosticsEnabled(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return false
  return process.env.MCP_HTTP_DIAGNOSTICS !== 'false'
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Wraps a `FetchLike` so every request/response in the MCP OAuth or transport flow is
 * logged with timing. `phase` distinguishes the two so the transport `initialize` — the
 * suspected hang — can be traced chunk-by-chunk while OAuth bodies stay unlogged.
 */
export function withMcpHttpDiagnostics(
  fetchFn: FetchLike,
  phase: 'oauth' | 'transport'
): FetchLike {
  if (!diagnosticsEnabled()) return fetchFn

  return async (input, init) => {
    const url = requestUrl(input as string | URL | Request)
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

    const contentType = res.headers.get('content-type') ?? ''
    const safeHeaders: Record<string, string> = {}
    for (const [name, value] of res.headers.entries()) {
      const lower = name.toLowerCase()
      safeHeaders[name] =
        lower === 'set-cookie' || lower === 'authorization' || lower === 'www-authenticate'
          ? '<omitted>'
          : sanitizeForLogging(value, 200)
    }

    logger.info('response', {
      phase,
      method,
      url,
      status: res.status,
      contentType,
      mcpSessionId: res.headers.get('mcp-session-id') ? 'present' : 'absent',
      headerMs: Date.now() - startedAt,
      headers: safeHeaders,
    })

    // Only the transport body is safe to log (MCP protocol JSON, no credentials).
    if (phase !== 'transport' || !res.body) return res

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
            logger.info('transport body complete', {
              phase,
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
            logger.info('transport body chunk', {
              phase,
              url,
              chunk: chunks,
              size: value.byteLength,
              ms: Date.now() - startedAt,
              preview: sanitizeForLogging(decoder.decode(value, { stream: true }), PREVIEW_CHARS),
            })
          }
        }
      } catch (error) {
        logger.warn('transport body read error', {
          phase,
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
