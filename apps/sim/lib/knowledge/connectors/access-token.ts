import { decryptApiKey } from '@/lib/api-key/crypto'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import type { ConnectorAuthConfig } from '@/connectors/types'

/**
 * What a connector authenticates to its source with: the access token, plus the
 * provider metadata that comes back alongside it.
 *
 * The metadata matters only for service-account credentials. A person's OAuth
 * account is discovered from the token itself — Confluence, for instance,
 * resolves its cloud id from `accessible-resources` with the bearer token in
 * hand. A service account carries an API token that cannot make that call, so
 * the site it is bound to is recorded on the credential and travels with the
 * token or not at all.
 */
export interface ConnectorAccessToken {
  accessToken: string
  /** Atlassian only — the Confluence/Jira cloud id the credential is bound to. */
  cloudId?: string
}

/**
 * The scopes to mint a service-account token with for this connector, or
 * `undefined` when the connector is not OAuth-backed.
 *
 * A provider whose two-legged grant accepts the same scopes as its consent
 * screen needs no `serviceAccountScopes` of its own; declaring one is how a
 * connector says the two sets differ.
 */
export function connectorServiceAccountScopes(auth: ConnectorAuthConfig): string[] | undefined {
  if (auth.mode !== 'oauth') return undefined
  return auth.serviceAccountScopes ?? auth.requiredScopes
}

/**
 * Resolves the token a connector syncs with, from its declared auth mode and
 * the credential or key it holds.
 *
 * `userId` must own the OAuth account behind the credential — not the knowledge
 * base owner. Workspace-scoped credentials are routinely authorized by a
 * different member, and token reads are scoped to `account.userId`. A service
 * account mints its own token and ignores the argument entirely.
 *
 * Returns `null` when an OAuth credential has no resolvable token, which is a
 * reconnect prompt rather than a fault. Throws only when the connector row and
 * its declared auth mode disagree, which is a bug or a corrupted row.
 */
export async function resolveConnectorAccessToken(params: {
  auth: ConnectorAuthConfig
  connector: { credentialId: string | null; encryptedApiKey: string | null }
  userId: string
  requestId: string
}): Promise<ConnectorAccessToken | null> {
  const { auth, connector, userId, requestId } = params

  if (auth.mode === 'apiKey') {
    if (!connector.encryptedApiKey) {
      if (auth.optional) return { accessToken: '' }
      throw new Error('API key connector is missing encrypted API key')
    }
    const { decrypted } = await decryptApiKey(connector.encryptedApiKey)
    return { accessToken: decrypted }
  }

  if (!connector.credentialId) {
    throw new Error('OAuth connector is missing credential ID')
  }

  const bundle = await resolveCredentialTokenBundle(
    connector.credentialId,
    userId,
    requestId,
    connectorServiceAccountScopes(auth)
  )
  if (!bundle?.accessToken) return null

  return {
    accessToken: bundle.accessToken,
    ...(bundle.cloudId ? { cloudId: bundle.cloudId } : {}),
  }
}
