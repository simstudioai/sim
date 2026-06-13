import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import { loadOauthRow } from '@/lib/mcp/oauth/storage'
import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

const logger = createLogger('McpOauthRevoke')
const REVOKE_TIMEOUT_MS = 5000

/**
 * Best-effort RFC 7009 revocation of tokens at the authorization server.
 * Never throws — revocation is advisory and must not block disconnect/delete flows.
 */
export async function revokeMcpOauthTokens(mcpServerId: string): Promise<void> {
  try {
    const row = await loadOauthRow({ mcpServerId })
    if (!row?.tokens) return

    const [server] = await db
      .select({
        url: mcpServers.url,
        oauthClientId: mcpServers.oauthClientId,
        oauthClientSecret: mcpServers.oauthClientSecret,
      })
      .from(mcpServers)
      .where(eq(mcpServers.id, mcpServerId))
      .limit(1)
    if (!server?.url) return

    const ssrfGuardedFetch = createSsrfGuardedMcpFetch()
    const info = await discoverOAuthServerInfo(server.url, { fetchFn: ssrfGuardedFetch }).catch(
      () => undefined
    )
    const metadata = info?.authorizationServerMetadata as
      | (Record<string, unknown> & { revocation_endpoint?: string })
      | undefined
    const revocationEndpoint = metadata?.revocation_endpoint
    if (!revocationEndpoint) return

    const clientInfo = row.clientInformation
    const clientId = clientInfo?.client_id ?? server.oauthClientId ?? undefined
    if (!clientId) return

    let clientSecret = clientInfo?.client_secret
    if (!clientSecret && server.oauthClientSecret) {
      try {
        const { decrypted } = await decryptSecret(server.oauthClientSecret)
        clientSecret = decrypted
      } catch {
        clientSecret = undefined
      }
    }

    const tokensToRevoke: Array<{ token: string; hint: 'refresh_token' | 'access_token' }> = []
    if (row.tokens.refresh_token) {
      tokensToRevoke.push({ token: row.tokens.refresh_token, hint: 'refresh_token' })
    }
    if (row.tokens.access_token) {
      tokensToRevoke.push({ token: row.tokens.access_token, hint: 'access_token' })
    }

    for (const { token, hint } of tokensToRevoke) {
      await postRevoke(revocationEndpoint, token, hint, clientId, clientSecret, ssrfGuardedFetch)
    }
  } catch (error) {
    logger.warn(`Token revocation failed for server ${mcpServerId}`, {
      error: toError(error).message,
    })
  }
}

async function postRevoke(
  endpoint: string,
  token: string,
  hint: 'refresh_token' | 'access_token',
  clientId: string,
  clientSecret: string | undefined,
  fetchFn: FetchLike
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    }
    const params = new URLSearchParams({ token, token_type_hint: hint })
    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    } else {
      params.set('client_id', clientId)
    }
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: params.toString(),
      signal: controller.signal,
    })
    if (!res.ok) {
      logger.info(`Revocation returned ${res.status} for ${hint}; treating as best-effort`)
    }
  } finally {
    clearTimeout(timer)
  }
}
