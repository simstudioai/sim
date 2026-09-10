import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  getServiceAccountToken,
  resolveCredentialTokenBundle,
  resolveOAuthAccountId,
} from '@/lib/oauth/credential-service'
import { GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { getConnectorApiKeyConfig } from '@/connectors/auth'
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
  /** The trusted site domain belonging to the credential's cloud id. */
  domain?: string
  /** Server-only capability bound to this credential and the connector's declared scopes. */
  getDelegatedAccessToken?: (subject: string) => Promise<string>
}

/**
 * The scopes to mint a service-account token with for this connector, or
 * `undefined` when the connector is not OAuth-backed.
 *
 * A provider whose two-legged grant accepts the same scopes as its consent
 * screen needs no `serviceAccountScopes` of its own; declaring one is how a
 * connector says the two sets differ.
 */
export function connectorServiceAccountScopes(
  auth: ConnectorAuthConfig,
  accessMode: ConnectorAccessMode = 'workspace'
): string[] | undefined {
  if (auth.mode !== 'oauth') return undefined
  if (accessMode === 'admin' && auth.adminServiceAccountScopes) {
    return auth.adminServiceAccountScopes
  }
  return auth.serviceAccountScopes ?? auth.requiredScopes
}

/**
 * The person a service-account credential should act as for this connector, or
 * `undefined` when the connector names no subject field or the field is blank.
 *
 * Trimmed and case-folded, so the same administrator spelled two ways is one
 * subject — and so the value can be read back as the source's tenant without
 * each caller re-normalising it.
 */
export function connectorServiceAccountSubject(
  auth: ConnectorAuthConfig,
  sourceConfig: Record<string, unknown>
): string | undefined {
  if (auth.mode !== 'oauth' || !auth.serviceAccountSubjectFieldId) return undefined
  const raw = sourceConfig[auth.serviceAccountSubjectFieldId]
  if (typeof raw !== 'string') return undefined
  const subject = normalizeEmail(raw)
  return subject.length > 0 ? subject : undefined
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
 * reconnect prompt rather than a fault. Credential and token-exchange failures
 * propagate to the caller.
 */
export async function resolveConnectorAccessToken(params: {
  auth: ConnectorAuthConfig
  accessMode?: ConnectorAccessMode
  connector: { credentialId: string | null; encryptedApiKey: string | null }
  userId: string
  requestId: string
  /**
   * Where a service-account credential's impersonation subject lives. Always
   * passed on a path that has it. Without a subject, a Drive service account
   * sees files shared with the service account itself, rather than the configured
   * person's files.
   */
  sourceConfig: Record<string, unknown>
}): Promise<ConnectorAccessToken | null> {
  const { auth, connector, userId, requestId } = params

  const apiKeyConfig = getConnectorApiKeyConfig(auth)
  if (
    auth.mode === 'apiKey' ||
    (apiKeyConfig && !connector.credentialId && connector.encryptedApiKey)
  ) {
    if (!connector.encryptedApiKey) {
      if (apiKeyConfig?.optional) return { accessToken: '' }
      throw new Error('API key connector is missing encrypted API key')
    }
    const { decrypted } = await decryptApiKey(connector.encryptedApiKey)
    return { accessToken: decrypted }
  }

  if (!connector.credentialId) {
    throw new Error('OAuth connector is missing credential ID')
  }

  const subject = connectorServiceAccountSubject(auth, params.sourceConfig)
  const githubRepositoryScope =
    auth.mode === 'oauth' && auth.provider === 'github-repositories'
      ? {
          repositoryId:
            typeof params.sourceConfig.githubRepositoryId === 'string'
              ? params.sourceConfig.githubRepositoryId
              : undefined,
          repository:
            typeof params.sourceConfig.repository === 'string'
              ? params.sourceConfig.repository
              : undefined,
        }
      : undefined
  const bundle = await resolveCredentialTokenBundle(
    connector.credentialId,
    userId,
    requestId,
    connectorServiceAccountScopes(auth, params.accessMode),
    subject,
    ...(githubRepositoryScope ? [{ githubRepositoryScope }] : [])
  )
  if (!bundle?.accessToken) return null

  let getDelegatedAccessToken: ConnectorAccessToken['getDelegatedAccessToken']
  if (
    params.accessMode === 'admin' &&
    auth.mode === 'oauth' &&
    auth.serviceAccountDelegationScopes?.length
  ) {
    const identity = await resolveOAuthAccountId(connector.credentialId)
    if (
      identity?.credentialType === 'service_account' &&
      identity.providerId === GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID &&
      identity.credentialId
    ) {
      const credentialId = identity.credentialId
      const scopes = [...auth.serviceAccountDelegationScopes]
      getDelegatedAccessToken = async (subject) => {
        const email = normalizeEmail(subject)
        if (!isValidEmailSyntax(email)) {
          throw new Error('A valid Workspace user email is required for delegated access')
        }
        return getServiceAccountToken(credentialId, scopes, email)
      }
    }
  }

  return {
    accessToken: bundle.accessToken,
    ...(getDelegatedAccessToken ? { getDelegatedAccessToken } : {}),
    ...(bundle.cloudId
      ? { cloudId: bundle.cloudId, ...(bundle.domain ? { domain: bundle.domain } : {}) }
      : {}),
  }
}

/**
 * The user a connector's token resolves under.
 *
 * Token reads are scoped to the account's owner, who is routinely not the
 * knowledge base owner: the OAuth account behind a shared credential belongs
 * to whoever connected it. A service account mints its own token and ignores
 * the argument, so the fallback stands. Null when the credential is no longer
 * usable from the workspace, which every caller treats as "reconnect".
 */
export async function resolveConnectorTokenUserId(input: {
  credentialId: string | null
  workspaceId?: string
  organizationId?: string
  fallbackUserId: string
}): Promise<string | null> {
  if (!input.credentialId) return input.fallbackUserId
  const identity = await resolveCredentialTokenIdentity(
    input.credentialId,
    resourceScopeFromOwner(input)
  )
  if (!identity) return null
  return identity.kind === 'oauth' ? identity.userId : input.fallbackUserId
}

/**
 * What a run's `syncContext` is seeded with from the token: the site a
 * service account already knows, so a connector never has to discover with a
 * token that cannot. Every path that opens a connector with a token — the
 * content engine, the directory refresh, config validation — seeds the same
 * way, so a connector behaves identically on all of them.
 */
export function syncContextForToken(token: ConnectorAccessToken): Record<string, unknown> {
  return {
    ...(token.cloudId
      ? {
          cloudId: token.cloudId,
          ...(token.domain ? { credentialDomain: token.domain } : {}),
        }
      : {}),
    ...(token.getDelegatedAccessToken
      ? { getDelegatedAccessToken: token.getDelegatedAccessToken }
      : {}),
  }
}
