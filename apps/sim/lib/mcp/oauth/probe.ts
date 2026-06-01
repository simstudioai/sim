import { extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js'
import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@/lib/core/utils/urls'
import type { McpAuthType } from '@/lib/mcp/types'

const logger = createLogger('McpOauthProbe')

const PROBE_TIMEOUT_MS = 5000

export async function detectMcpAuthType(url: string): Promise<McpAuthType> {
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
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
      void closeMcpSession(url, sessionId)
    }

    if (res.status === 401) {
      const params = extractWWWAuthenticateParams(res)
      // Per RFC 9728, an OAuth-protected resource signals OAuth via
      // `resource_metadata=...` in WWW-Authenticate. `scope=...` is also an
      // OAuth-specific hint. A bare `error="invalid_token"` is generic Bearer
      // and used by plain API-key servers too, so it must not classify as OAuth.
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
 * allocated. Failures are ignored — the session will expire on the server side.
 */
async function closeMcpSession(url: string, sessionId: string): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      await fetch(url, {
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
