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
  mcpAuthGuarded,
  SimMcpOauthProvider,
} from '@/lib/mcp/oauth'
import { mcpService } from '@/lib/mcp/service'

const logger = createLogger('McpOauthCallbackAPI')

export const dynamic = 'force-dynamic'

class OauthCallbackStepTimeout extends Error {
  constructor(step: string, ms: number) {
    super(`MCP OAuth callback step "${step}" did not settle within ${ms}ms`)
    this.name = 'OauthCallbackStepTimeout'
  }
}

/**
 * Times and bounds one awaited step of the callback so a stalled operation
 * surfaces as a labeled, logged error instead of hanging the request forever.
 * The losing promise is not cancelled (a wedged DB/socket op can't be), so it
 * settles in the background with its rejection swallowed; the point is that the
 * request stops waiting on it and the logs name the exact step that stalled.
 */
async function timedStep<T>(step: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  logger.info(`OAuth callback step start: ${step}`)
  const work = Promise.resolve(fn())
  work.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const value = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OauthCallbackStepTimeout(step, ms)), ms)
        timer.unref?.()
      }),
    ])
    logger.info(`OAuth callback step done: ${step} (${Date.now() - start}ms)`)
    return value
  } catch (error) {
    logger.error(`OAuth callback step failed: ${step} (${Date.now() - start}ms)`, {
      error: toError(error).message,
    })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

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
  serverId?: string,
  state?: string
): NextResponse {
  if (!ok) {
    logger.warn(
      `MCP OAuth callback did not complete: ${reason}${serverId ? ` (server ${serverId})` : ''}`
    )
  }
  const safeMessage = escapeHtml(message)
  const title = ok ? 'Connected' : 'Connection failed'
  // Signal the opener over a same-origin BroadcastChannel rather than
  // `window.opener.postMessage`: a provider whose authorize page sets COOP
  // `same-origin` severs `window.opener`, which would silently drop the result and
  // leave the parent stuck on "Connecting…". A BroadcastChannel is origin-scoped and
  // unaffected by opener severance; the hook correlates on `state` and ignores flows it
  // did not start.
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: system-ui; padding: 24px"><p>${safeMessage}</p><script>
    try { var ch = new BroadcastChannel('mcp-oauth'); ch.postMessage({ type: 'mcp-oauth', ok: ${ok ? 'true' : 'false'}, serverId: ${jsonLiteral(serverId)}, state: ${jsonLiteral(state)}, reason: ${jsonLiteral(reason)} }); ch.close() } catch (e) {}
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

  // Echo the flow's `state` on every result so the opener can correlate a broadcast back to
  // the exact flow it started — including failures (e.g. `invalid_state`) that never resolve
  // a serverId. Without it those results would strand the initiating tab on "Connecting…".
  const respond = (
    message: string,
    ok: boolean,
    reason: McpOauthCallbackReason,
    serverId?: string
  ) => htmlClose(message, ok, reason, serverId, state)

  const initialRow = state ? await loadOauthRowByState(state).catch(() => null) : null
  const stateRowServerId = initialRow?.mcpServerId

  if (errorParam) {
    logger.warn(`MCP OAuth callback received error: ${errorParam}`)
    if (initialRow) await clearState(initialRow.id, 'callback:provider_error').catch(() => {})
    return respond(`Authorization failed: ${errorParam}`, false, 'provider_error', stateRowServerId)
  }
  if (!state || !code) {
    return respond(
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
      return respond(
        'You must be signed in to complete authorization.',
        false,
        'unauthenticated',
        stateRowServerId
      )
    }

    const row = initialRow
    if (!row) {
      return respond('Invalid or expired authorization state.', false, 'invalid_state')
    }
    serverId = row.mcpServerId

    if (session.user.id !== row.userId) {
      return respond(
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
      return respond('Server no longer exists.', false, 'server_gone', serverId)
    }
    if (server.workspaceId !== row.workspaceId) {
      return respond(
        'Workspace mismatch on authorization callback.',
        false,
        'invalid_state',
        serverId
      )
    }
    const serverUrl = server.url
    try {
      assertSafeOauthServerUrl(serverUrl)
    } catch {
      return respond(
        'MCP OAuth requires https (or http://localhost for development).',
        false,
        'insecure_url',
        serverId
      )
    }

    // Burn state before token exchange so a replayed callback cannot reuse it.
    await timedStep('clearState(burn)', 10_000, () =>
      clearState(row.id, 'callback:burn-before-exchange')
    )

    const preregistered = await timedStep('loadPreregisteredClient', 15_000, () =>
      loadPreregisteredClient(server.id)
    )
    const provider = new SimMcpOauthProvider({ row, preregistered })
    let result: Awaited<ReturnType<typeof mcpAuthGuarded>>
    try {
      result = await timedStep('mcpAuthGuarded', 120_000, () =>
        mcpAuthGuarded(provider, {
          serverUrl,
          authorizationCode: code,
        })
      )
    } catch (e) {
      logger.error('Token exchange failed during MCP OAuth callback', e)
      return respond(
        'Token exchange failed. Please try again.',
        false,
        'token_exchange_failed',
        server.id
      )
    } finally {
      await timedStep('clearVerifier', 10_000, () => clearVerifier(row.id)).catch((e) =>
        logger.error('Failed to clear PKCE verifier after MCP OAuth callback', {
          error: toError(e).message,
        })
      )
    }

    if (result !== 'AUTHORIZED') {
      return respond('Authorization did not complete.', false, 'token_exchange_failed', server.id)
    }

    try {
      // forceRefresh: skip any stale cache from before re-auth.
      await timedStep('discoverServerTools', 60_000, () =>
        mcpService.discoverServerTools(session.user.id, server.id, server.workspaceId, true)
      )
    } catch (e) {
      logger.warn('Post-auth tools refresh failed', toError(e).message)
    }

    return respond('Connected. You can close this window.', true, 'authorized', server.id)
  } catch (error) {
    logger.error('MCP OAuth callback failed', error)
    return respond('Authorization failed. Please try again.', false, 'unknown', serverId)
  }
})
