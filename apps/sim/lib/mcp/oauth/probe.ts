import { extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createLogger } from '@sim/logger'
import { createPinnedFetch } from '@/lib/core/security/input-validation.server'
import { isLoopbackHostname } from '@/lib/core/utils/urls'
import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'
import type { McpAuthType } from '@/lib/mcp/types'

const logger = createLogger('McpOauthProbe')

const PROBE_TIMEOUT_MS = 5000

/**
 * Probes an MCP server URL to classify its auth requirement.
 *
 * The probe must never re-resolve DNS independently of the caller's SSRF
 * validation, or it re-opens the DNS-rebinding window. When the caller passes a
 * pre-validated `resolvedIP` the connection is pinned to it; otherwise an
 * SSRF-guarded fetch validates and pins each request itself.
 */
export async function detectMcpAuthType(
  url: string,
  resolvedIP?: string | null
): Promise<McpAuthType> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'headers'
  }
  const isLoopbackHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)
  if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
    return 'headers'
  }

  const probeFetch: FetchLike = resolvedIP
    ? createPinnedFetch(resolvedIP)
    : createSsrfGuardedMcpFetch()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const res = await probeFetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'sim-platform-probe', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
    })

    const sessionId = res.headers.get('mcp-session-id')
    if (sessionId) {
      void closeMcpSession(url, sessionId, probeFetch)
    }

    if (res.status === 401) {
      const params = extractWWWAuthenticateParams(res)
      // RFC 9728: resource_metadata / scope signal OAuth; a bare invalid_token is generic Bearer (API-key servers use it too).
      if (params.resourceMetadataUrl || params.scope) {
        return 'oauth'
      }
      return 'headers'
    }

    if (res.ok) return 'none'
    return 'headers'
  } catch (e) {
    logger.warn(`Probe failed for ${url}`, e)
    return 'headers'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best-effort DELETE to release the streamable-HTTP session the probe just
 * allocated. Reuses the probe's pinned fetch so this cleanup hop stays pinned.
 * Failures are ignored — the session will expire on the server side.
 */
async function closeMcpSession(
  url: string,
  sessionId: string,
  probeFetch: FetchLike
): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      await probeFetch(url, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Ignore — best-effort cleanup
  }
}
