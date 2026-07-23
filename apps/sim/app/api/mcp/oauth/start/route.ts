import { OAuthError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { startMcpOauthContract } from '@/lib/api/contracts/mcp'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withMcpAuth } from '@/lib/mcp/middleware'
import {
  assertSafeOauthServerUrl,
  getOrCreateOauthRow,
  loadPreregisteredClient,
  McpOauthInsecureUrlError,
  McpOauthRedirectRequired,
  makeTimedStep,
  mcpAuthGuarded,
  OauthStepTimeoutError,
  SimMcpOauthProvider,
  setOauthRowUser,
} from '@/lib/mcp/oauth'
import { createMcpErrorResponse } from '@/lib/mcp/utils'

const logger = createLogger('McpOauthStartAPI')
const timedStep = makeTimedStep(logger)
const OAUTH_START_TTL_MS = 10 * 60 * 1000
/**
 * OAuth discovery + DCR occasionally hits the transient headers-then-stalled-body class we've
 * documented for CDN-fronted MCP hosts — a per-connection stall a fresh attempt dodges. Bound
 * each attempt tightly and retry once so an intermittent stall recovers automatically instead
 * of hanging the browser popup to the client's timeout. Two 12s attempts stay under the
 * client's 30s `/oauth/start` deadline.
 */
const MCP_AUTH_ATTEMPT_MS = 12_000
const MCP_AUTH_MAX_ATTEMPTS = 2
const MAX_SURFACED_ERROR_LENGTH = 250
const DCR_UNSUPPORTED_MESSAGE =
  "This server doesn't support automatic OAuth client registration. Add a pre-registered OAuth client ID and secret, or configure a token instead."

/**
 * The MCP SDK throws a plain `Error` (no typed class or code) when an auth server lacks a
 * `registration_endpoint`, so this string-match is the only available signal. Pinned to
 * `@modelcontextprotocol/sdk` v1.29.0 `registerClient` (client/auth.js): "Incompatible auth
 * server: does not support dynamic client registration". If a version bump rephrases this, the
 * 422 branch silently stops firing (users get a generic 500) — update the substring here.
 */
function isDynamicClientRegistrationUnsupported(error: unknown): boolean {
  return getErrorMessage(error, '')
    .toLowerCase()
    .includes('does not support dynamic client registration')
}

export function surfaceOauthError(error: unknown): string {
  // Spec-compliant OAuth servers throw typed subclasses with clean RFC 6749 fields.
  if (error instanceof OAuthError && !(error instanceof ServerError)) {
    return truncate(`${error.errorCode}: ${error.message}`)
  }

  // ServerError wraps non-spec response bodies as "HTTP N: Invalid OAuth error
  // response: ... Raw body: {...}". Dig the vendor message out of the JSON tail.
  if (error instanceof Error) {
    const rawBodyMatch = error.message.match(/Raw body:\s*(\{[\s\S]*\})\s*$/)
    if (rawBodyMatch) {
      try {
        const body = JSON.parse(rawBodyMatch[1]) as Record<string, unknown>
        const vendorMessage =
          (typeof body.error_description === 'string' && body.error_description) ||
          (typeof body.message === 'string' && body.message) ||
          (typeof body.error === 'string' && body.error) ||
          null
        if (vendorMessage) return truncate(`Authorization server: ${vendorMessage}`)
      } catch {}
    }
    return truncate(error.message.split('\n')[0] || 'Failed to start OAuth flow')
  }
  return 'Failed to start OAuth flow'
}

function truncate(message: string): string {
  return message.length > MAX_SURFACED_ERROR_LENGTH
    ? `${message.slice(0, MAX_SURFACED_ERROR_LENGTH)}…`
    : message
}

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  withMcpAuth('write')(async (request: NextRequest, { userId, workspaceId }) => {
    try {
      const parsed = await parseRequest(startMcpOauthContract, request, {})
      if (!parsed.success) return parsed.response
      const { serverId } = parsed.data.query
      logger.info(`Starting MCP OAuth flow for server ${serverId}`)

      const [server] = await timedStep('loadServer', 15_000, () =>
        db
          .select()
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.id, serverId),
              eq(mcpServers.workspaceId, workspaceId),
              isNull(mcpServers.deletedAt)
            )
          )
          .limit(1)
      )

      if (!server) {
        return createMcpErrorResponse(new Error('Server not found'), 'Server not found', 404)
      }
      if (server.authType !== 'oauth') {
        return createMcpErrorResponse(
          new Error(`Server authType is "${server.authType}", not oauth`),
          'Server is not configured for OAuth',
          400
        )
      }
      if (!server.url) {
        return createMcpErrorResponse(new Error('Server has no URL'), 'Missing server URL', 400)
      }
      const serverUrl = server.url
      try {
        assertSafeOauthServerUrl(serverUrl)
      } catch (e) {
        if (e instanceof McpOauthInsecureUrlError) {
          return createMcpErrorResponse(
            e,
            'MCP OAuth requires https (or http://localhost for development)',
            400
          )
        }
        throw e
      }

      const row = await timedStep('getOrCreateOauthRow', 15_000, () =>
        getOrCreateOauthRow({
          mcpServerId: server.id,
          userId,
          workspaceId,
        })
      )
      const hasActiveFlow =
        !!row.state &&
        !!row.stateCreatedAt &&
        row.stateCreatedAt.getTime() > Date.now() - OAUTH_START_TTL_MS
      if (hasActiveFlow && row.userId && row.userId !== userId) {
        return createMcpErrorResponse(
          new Error('OAuth authorization already in progress'),
          'OAuth authorization already in progress for this server',
          409
        )
      }
      if (row.userId !== userId) {
        await setOauthRowUser(row.id, userId)
        row.userId = userId
      }
      const preregistered = await timedStep('loadPreregisteredClient', 15_000, () =>
        loadPreregisteredClient(server.id)
      )
      const provider = new SimMcpOauthProvider({ row, preregistered })

      try {
        // OAuth discovery + DCR through the guarded fetch. Each attempt is bounded (labeled in
        // logs); a per-connection transient stall on the first attempt is retried on a fresh
        // one. `McpOauthRedirectRequired` is the SUCCESS signal — rethrow it immediately so the
        // outer catch returns the authorize URL; only a bounded timeout is retried.
        let result: Awaited<ReturnType<typeof mcpAuthGuarded>> | undefined
        for (let attempt = 1; attempt <= MCP_AUTH_MAX_ATTEMPTS; attempt++) {
          try {
            result = await timedStep(
              `mcpAuthGuarded (attempt ${attempt})`,
              MCP_AUTH_ATTEMPT_MS,
              () => mcpAuthGuarded(provider, { serverUrl })
            )
            break
          } catch (attemptError) {
            if (attemptError instanceof OauthStepTimeoutError && attempt < MCP_AUTH_MAX_ATTEMPTS) {
              logger.warn(`MCP OAuth start stalled for server ${serverId}, retrying`)
              await sleep(250)
              continue
            }
            throw attemptError
          }
        }
        if (result === 'AUTHORIZED') {
          return NextResponse.json({ status: 'already_authorized' })
        }
        return createMcpErrorResponse(
          new Error('Provider did not capture redirect URL'),
          'Failed to start OAuth flow',
          500
        )
      } catch (e) {
        if (e instanceof McpOauthRedirectRequired) {
          logger.info(`OAuth redirect for server ${serverId}`)
          return NextResponse.json({
            status: 'redirect',
            authorizationUrl: e.authorizationUrl,
          })
        }
        if (isDynamicClientRegistrationUnsupported(e)) {
          return createMcpErrorResponse(toError(e), DCR_UNSUPPORTED_MESSAGE, 422)
        }
        throw e
      }
    } catch (error) {
      logger.error('Error starting MCP OAuth flow:', error)
      // Only surface OAuth-flow errors verbatim; everything else (DB, decryption,
      // network) gets a generic message to avoid leaking internal details.
      const userMessage =
        error instanceof OAuthError ? surfaceOauthError(error) : 'Failed to start OAuth flow'
      return createMcpErrorResponse(toError(error), userMessage, 500)
    }
  })
)
