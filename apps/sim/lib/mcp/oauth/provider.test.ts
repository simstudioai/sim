import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { dbChainMockFns, encryptionMock, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { SimMcpOauthProvider } from '@/lib/mcp/oauth/provider'
import type { McpOauthRow } from '@/lib/mcp/oauth/storage'

const SERVER_URL = 'https://mcp.example.com/mcp'
const ISSUER = 'https://auth.example.com'

function grantRow(): McpOauthRow {
  return {
    id: 'oauth-row-1',
    mcpServerId: 'server-1',
    userId: 'authorizer-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    clientInformation: { client_id: 'client-1', issuer: ISSUER },
    tokens: { access_token: 'expired', token_type: 'bearer', refresh_token: 'refresh-1' },
    codeVerifier: null,
    state: null,
    stateCreatedAt: null,
    updatedAt: new Date(),
  }
}

/** An authorization server whose token endpoint answers every refresh with `token`. */
function authorizationServer(token: { status: number; body: Record<string, unknown> }) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input)
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url.startsWith('https://mcp.example.com/.well-known/oauth-protected-resource'))
      return json(200, { resource: SERVER_URL, authorization_servers: [ISSUER] })
    if (url.startsWith(`${ISSUER}/.well-known/`))
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      })
    if (url === `${ISSUER}/token`) return json(token.status, token.body)
    return json(404, {})
  })
}

/**
 * Best-effort discovery connects with the workspace's one shared grant. A refresh that fails
 * there must leave the grant as it was: the SDK otherwise clears the tokens and starts a new
 * authorization flow, disconnecting the server for every member.
 */
describe('SimMcpOauthProvider preserving the shared grant', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('writes nothing to the OAuth row when a refresh is rejected', async () => {
    const provider = new SimMcpOauthProvider({ row: grantRow(), preserveGrant: true })

    await expect(
      auth(provider, {
        serverUrl: SERVER_URL,
        fetchFn: authorizationServer({ status: 400, body: { error: 'invalid_grant' } }),
      })
    ).rejects.toThrow('MCP OAuth grant left unchanged')

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(provider.tokens()?.refresh_token).toBe('refresh-1')
  })

  it('persists a successful refresh, which keeps the grant valid for everyone', async () => {
    const provider = new SimMcpOauthProvider({ row: grantRow(), preserveGrant: true })

    await expect(
      auth(provider, {
        serverUrl: SERVER_URL,
        fetchFn: authorizationServer({
          status: 200,
          body: { access_token: 'fresh', token_type: 'bearer', refresh_token: 'refresh-2' },
        }),
      })
    ).resolves.toBe('AUTHORIZED')

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(provider.tokens()?.access_token).toBe('fresh')
  })
})
