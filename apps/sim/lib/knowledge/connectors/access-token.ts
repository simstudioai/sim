import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { decryptApiKey } from '@/lib/api-key/crypto'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import { awsCredentialFailureMessage, isTransientAwsFailure } from '@/lib/internal/aws/failure'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  getServiceAccountToken,
  resolveCredentialTokenBundle,
  resolveOAuthAccountId,
} from '@/lib/oauth/credential-service'
import { GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  connectorUsesCredential,
  getConnectorApiKeyConfig,
  getConnectorCredentialService,
} from '@/connectors/auth'
import { awsSessionSyncContext, type ConnectorAwsSession } from '@/connectors/aws-session'
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
  /**
   * The provider API base a minted service-account token is bound to (a
   * DocuSign JWT Grant credential's account). Never present for OAuth.
   */
  instanceUrl?: string
  /** Server-only capability bound to this credential and the connector's declared scopes. */
  getDelegatedAccessToken?: (subject: string, signal?: AbortSignal) => Promise<string>
  /**
   * AWS only — the keys a saved AWS credential resolved to for the knowledge
   * base's scope. A saved AWS credential has no bearer token, so `accessToken`
   * is empty and the connector signs with these instead.
   */
  awsSession?: ConnectorAwsSession
  /** When the credential stops working, if it says; a holder may reuse it until shortly before. */
  expiresAt?: Date
}

/**
 * Every secret a resolved token carries, for redacting provider text that may
 * echo one back. A saved AWS credential's secrets sit in `awsSession`, not in
 * the empty bearer, so callers redact this list rather than `accessToken` alone.
 */
export function connectorTokenSecrets(token: ConnectorAccessToken): string[] {
  return [
    token.accessToken,
    ...(token.awsSession
      ? [token.awsSession.secretAccessKey, token.awsSession.sessionToken ?? '']
      : []),
  ]
}

/** The connector-facing service that a saved AWS credential authenticates. */
const AWS_CREDENTIAL_SERVICE = 'aws'

/**
 * A saved AWS credential that could not be used: unavailable in this scope,
 * refused by AWS STS, or not resolvable while AWS was briefly unavailable
 * (`transient`). The message is the AWS reason, never a secret.
 */
export class ConnectorAwsCredentialError extends Error {
  readonly transient: boolean

  constructor(message: string, options: { cause: unknown; transient: boolean }) {
    super(message, { cause: options.cause })
    this.name = 'ConnectorAwsCredentialError'
    this.transient = options.transient
  }
}

/**
 * Resolves a saved AWS credential to signing keys for the knowledge base's own
 * scope. The owner check and the STS exchange are the same ones AWS tools use,
 * so a credential from another workspace or organization never resolves here.
 */
async function resolveConnectorAwsToken(
  credentialId: string,
  scope: ResourceScope,
  requestId: string,
  signal: AbortSignal | undefined
): Promise<ConnectorAccessToken> {
  const { resolveAuthorizedAwsCredential } = await import('@/lib/internal/aws/credentials')
  let session: Awaited<ReturnType<typeof resolveAuthorizedAwsCredential>>
  try {
    session = await resolveAuthorizedAwsCredential(
      credentialId,
      { ...resourceScopeFields(scope), executionId: requestId },
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    throw new ConnectorAwsCredentialError(awsCredentialFailureMessage(error), {
      cause: error,
      transient: isTransientAwsFailure(error),
    })
  }
  return {
    accessToken: '',
    awsSession: {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
    },
    ...(session.expiration ? { expiresAt: session.expiration } : {}),
  }
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
   * The knowledge base's owner. A credential that resolves per scope (a saved
   * AWS credential) is loaded only from this workspace or organization.
   */
  scope: ResourceScope
  /**
   * Where a service-account credential's impersonation subject lives. Always
   * passed on a path that has it. Without a subject, a Drive service account
   * sees files shared with the service account itself, rather than the configured
   * person's files.
   */
  sourceConfig: Record<string, unknown>
  signal?: AbortSignal
}): Promise<ConnectorAccessToken | null> {
  const { auth, connector, userId, requestId } = params
  params.signal?.throwIfAborted()

  const apiKeyConfig = getConnectorApiKeyConfig(auth)
  if (!connectorUsesCredential(auth, connector)) {
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

  if (getConnectorCredentialService(auth) === AWS_CREDENTIAL_SERVICE) {
    return resolveConnectorAwsToken(connector.credentialId, params.scope, requestId, params.signal)
  }
  if (auth.mode !== 'oauth') {
    throw new Error('This connector cannot authenticate with a saved credential')
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
    {
      service: auth.provider,
      ...(githubRepositoryScope ? { githubRepositoryScope } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    }
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
      getDelegatedAccessToken = async (subject, signal) => {
        const tokenSignal =
          signal && params.signal
            ? AbortSignal.any([signal, params.signal])
            : (signal ?? params.signal)
        tokenSignal?.throwIfAborted()
        const email = normalizeEmail(subject)
        if (!isValidEmailSyntax(email)) {
          throw new Error('A valid Workspace user email is required for delegated access')
        }
        return getServiceAccountToken(
          credentialId,
          scopes,
          email,
          ...(tokenSignal ? [{ signal: tokenSignal }] : [])
        )
      }
    }
  }

  return {
    accessToken: bundle.accessToken,
    ...(getDelegatedAccessToken ? { getDelegatedAccessToken } : {}),
    ...(bundle.cloudId
      ? { cloudId: bundle.cloudId, ...(bundle.domain ? { domain: bundle.domain } : {}) }
      : {}),
    ...(bundle.instanceUrl ? { instanceUrl: bundle.instanceUrl } : {}),
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
    ...(token.instanceUrl ? { credentialInstanceUrl: token.instanceUrl } : {}),
    ...(token.getDelegatedAccessToken
      ? { getDelegatedAccessToken: token.getDelegatedAccessToken }
      : {}),
    ...(token.awsSession ? awsSessionSyncContext(token.awsSession) : {}),
  }
}

/** A token that states its expiry is reused until this close to it; STS sessions last 15 minutes at least. */
const TOKEN_REUSE_MARGIN_MS = 5 * 60 * 1000

/** A run's connector token, kept usable for the length of the run. */
export interface ConnectorRunToken {
  current(): ConnectorAccessToken
  /** Re-resolves the token before a later call, unless it is long-lived or states an expiry still well ahead. */
  refresh(): Promise<void>
}

/**
 * Holds the token one connector run syncs with. Each refresh re-resolves it, so a long run
 * outlives a short-lived token, and re-seeds what the token binds into the run's
 * `syncContext`, so a connector reading its credential's site or AWS session from there signs
 * with the current one. A token that states its expiry (an AWS STS session) is kept until
 * shortly before it rather than exchanged again on every page. Long-lived saved AWS keys (an
 * AWS session with no session token) are kept for the whole run, like a stored key, for which
 * `resolve` is absent.
 */
export function createConnectorRunToken(input: {
  token: ConnectorAccessToken
  syncContext: Record<string, unknown>
  resolve: (() => Promise<ConnectorAccessToken>) | undefined
}): ConnectorRunToken {
  let token = input.token
  return {
    current: () => token,
    async refresh() {
      if (!input.resolve) return
      if (token.awsSession && !token.awsSession.sessionToken) return
      if (token.expiresAt && token.expiresAt.getTime() - Date.now() > TOKEN_REUSE_MARGIN_MS) return
      token = await input.resolve()
      Object.assign(input.syncContext, syncContextForToken(token))
    },
  }
}
