import { auth as mcpAuth } from '@modelcontextprotocol/sdk/client/auth.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { mcpOauthCallbackContract } from '@/lib/api/contracts/mcp'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  assertSafeOauthServerUrl,
  clearState,
  clearVerifier,
  loadOauthRowByState,
  loadPreregisteredClient,
  type McpOauthCallbackReason,
  SimMcpOauthProvider,
} from '@/lib/mcp/oauth'
import { mcpService } from '@/lib/mcp/service'

const logger = createLogger('McpOauthCallbackAPI')

export const dynamic = 'force-dynamic'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function jsonLiteral(value: string | undefined): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

function htmlClose(
  message: string,
  ok: boolean,
  reason: McpOauthCallbackReason,
  serverId?: string
): NextResponse {
  const safeMessage = escapeHtml(message)
  const title = ok ? 'Connected' : 'Connection failed'
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: system-ui; padding: 24px"><p>${safeMessage}</p><script>
    try { window.opener && window.opener.postMessage({ type: 'mcp-oauth', ok: ${ok ? 'true' : 'false'}, serverId: ${jsonLiteral(serverId)}, reason: ${jsonLiteral(reason)} }, window.location.origin) } catch (e) {}
    setTimeout(function () { window.close() }, 800)
  </script></body></html>`
  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(mcpOauthCallbackContract, request, {})
  if (!parsed.success) {
    return htmlClose('Malformed authorization callback.', false, 'missing_params')
  }
  const { state, code, error: errorParam } = parsed.data.query

  const initialRow = state ? await loadOauthRowByState(state).catch(() => null) : null
  const stateRowServerId = initialRow?.mcpServerId

  if (errorParam) {
    logger.warn(`MCP OAuth callback received error: ${errorParam}`)
    if (initialRow) await clearState(initialRow.id).catch(() => {})
    return htmlClose(
      `Authorization failed: ${errorParam}`,
      false,
      'provider_error',
      stateRowServerId
    )
  }
  if (!state || !code) {
    return htmlClose(
      'Missing state or code in callback URL.',
      false,
      'missing_params',
      stateRowServerId
    )
  }

  let serverId: string | undefined
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return htmlClose(
        'You must be signed in to complete authorization.',
        false,
        'unauthenticated',
        stateRowServerId
      )
    }

    const row = initialRow
    if (!row) {
      return htmlClose('Invalid or expired authorization state.', false, 'invalid_state')
    }
    serverId = row.mcpServerId

    if (session.user.id !== row.userId) {
      return htmlClose(
        'You must be signed in as the same user that initiated the flow.',
        false,
        'user_mismatch',
        serverId
      )
    }

    const [server] = await db
      .select({ id: mcpServers.id, url: mcpServers.url, workspaceId: mcpServers.workspaceId })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, row.mcpServerId), isNull(mcpServers.deletedAt)))
      .limit(1)
    if (!server || !server.url) {
      return htmlClose('Server no longer exists.', false, 'server_gone', serverId)
    }
    if (server.workspaceId !== row.workspaceId) {
      return htmlClose(
        'Workspace mismatch on authorization callback.',
        false,
        'invalid_state',
        serverId
      )
    }
    try {
      assertSafeOauthServerUrl(server.url)
    } catch {
      return htmlClose(
        'MCP OAuth requires https (or http://localhost for development).',
        false,
        'insecure_url',
        serverId
      )
    }

    // Burn state before token exchange so a replayed callback cannot reuse it.
    await clearState(row.id)

    const preregistered = await loadPreregisteredClient(server.id)
    const provider = new SimMcpOauthProvider({ row, preregistered })
    let result: Awaited<ReturnType<typeof mcpAuth>>
    try {
      result = await mcpAuth(provider, {
        serverUrl: server.url,
        authorizationCode: code,
      })
    } catch (e) {
      logger.error('Token exchange failed during MCP OAuth callback', e)
      return htmlClose(
        'Token exchange failed. Please try again.',
        false,
        'token_exchange_failed',
        server.id
      )
    } finally {
      await clearVerifier(row.id)
    }

    if (result !== 'AUTHORIZED') {
      return htmlClose('Authorization did not complete.', false, 'token_exchange_failed', server.id)
    }

    try {
      // forceRefresh: skip any stale cache from before re-auth.
      await mcpService.discoverServerTools(session.user.id, server.id, server.workspaceId, true)
    } catch (e) {
      logger.warn('Post-auth tools refresh failed', toError(e).message)
    }

    return htmlClose('Connected. You can close this window.', true, 'authorized', server.id)
  } catch (error) {
    logger.error('MCP OAuth callback failed', error)
    return htmlClose('Authorization failed. Please try again.', false, 'unknown', serverId)
  }
})
