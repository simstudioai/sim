import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  loadManagedMcpRuntimeCredential,
  saveManagedMcpRuntimeTokens,
} from '@/lib/credentials/managed-mcp'
import { getOrCreateOauthRow, loadPreregisteredClient } from '@/lib/mcp/oauth'
import { ManagedMcpOauthProvider } from '@/lib/mcp/oauth/managed-provider'

/** Creates an OAuth provider whose refresh writes stay bound to the same personal grant. */
export async function loadManagedMcpAuthProvider(
  credentialId: string,
  workspaceId: string
): Promise<OAuthClientProvider> {
  const current = await loadManagedMcpRuntimeCredential(credentialId, workspaceId)
  const clientRow = await getOrCreateOauthRow({
    mcpServerId: current.mcpServerId,
    workspaceId: current.workspaceId,
  })
  const preregistered = await loadPreregisteredClient(current.mcpServerId)
  let tokenVersion: string | null = current.tokenVersion
  return new ManagedMcpOauthProvider({
    clientRow,
    preregistered,
    tokens: current.tokens,
    async onSaveTokens(tokens) {
      if (!tokenVersion) throw new Error('Managed MCP credential grant is no longer active')
      tokenVersion = await saveManagedMcpRuntimeTokens(current.credentialId, tokens, tokenVersion)
    },
  })
}
