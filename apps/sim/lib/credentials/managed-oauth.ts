import { db } from '@sim/db'
import { credential, credentialGroupEnrollment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import {
  type ResourceOwner,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  type CredentialGroupProviderAdapter,
  CredentialGroupProviderConfigurationError,
  type CredentialGroupProviderPolicy,
} from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapterByProviderId } from '@/lib/credential-groups/provider-registry'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('ManagedOAuthCredential')

const MANAGED_OAUTH_TOKEN_SET_TYPE = 'managed-oauth-token-set' as const
const MANAGED_OAUTH_TOKEN_SET_VERSION = 1 as const
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 30_000

export type ManagedOAuthCredentialErrorCode =
  | 'MANAGED_CREDENTIAL_NOT_FOUND'
  | 'MANAGED_CREDENTIAL_UNAVAILABLE'
  | 'MANAGED_CREDENTIAL_PROVIDER_MISMATCH'
  | 'MANAGED_CREDENTIAL_REVOKED'
  | 'MANAGED_CREDENTIAL_NEEDS_REAUTH'
  | 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE'
  | 'MANAGED_CREDENTIAL_INVALID_TOKEN_SET'
  | 'MANAGED_CREDENTIAL_REFRESH_FAILED'

export class ManagedOAuthCredentialError extends Error {
  constructor(
    readonly code: ManagedOAuthCredentialErrorCode,
    message: string,
    readonly statusCode: 401 | 403 | 404 | 500 | 502 | 503
  ) {
    super(message)
    this.name = 'ManagedOAuthCredentialError'
  }
}

export interface ManagedOAuthTokenSet {
  type: typeof MANAGED_OAUTH_TOKEN_SET_TYPE
  version: typeof MANAGED_OAUTH_TOKEN_SET_VERSION
  tokenType: 'Bearer'
  accessToken: string
  refreshToken?: string
  idToken?: string
}

export interface ResolvedManagedOAuthToken {
  accessToken: string
  idToken?: string
  refreshed: boolean
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

interface ResolveManagedOAuthTokenParams {
  credentialId: string
  workspaceId?: string
  organizationId?: string
  expectedProviderId: string
  requiredScopes: string[]
}

export interface ManagedOAuthCredentialApplicationContext extends WorkspaceAuthorizationContext {
  organizationId?: string
  credentialId: string
  credentialGroupId: string
  credentialGroupEnrollmentId: string
}

function isManagedOAuthTokenSet(value: unknown): value is ManagedOAuthTokenSet {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.type === MANAGED_OAUTH_TOKEN_SET_TYPE &&
    candidate.version === MANAGED_OAUTH_TOKEN_SET_VERSION &&
    candidate.tokenType === 'Bearer' &&
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    (candidate.refreshToken === undefined ||
      (typeof candidate.refreshToken === 'string' && candidate.refreshToken.length > 0)) &&
    (candidate.idToken === undefined ||
      (typeof candidate.idToken === 'string' && candidate.idToken.length > 0))
  )
}

/** Encrypts the versioned token envelope written by managed OAuth callbacks and refreshes. */
export async function encryptManagedOAuthTokenSet(tokenSet: {
  accessToken: string
  refreshToken?: string
  idToken?: string
}): Promise<string> {
  const accessToken = tokenSet.accessToken.trim()
  const refreshToken = tokenSet.refreshToken?.trim()
  const idToken = tokenSet.idToken?.trim()
  if (!accessToken) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
      'Managed OAuth access token is empty',
      500
    )
  }

  const envelope: ManagedOAuthTokenSet = {
    type: MANAGED_OAUTH_TOKEN_SET_TYPE,
    version: MANAGED_OAUTH_TOKEN_SET_VERSION,
    tokenType: 'Bearer',
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(idToken ? { idToken } : {}),
  }
  return (await encryptSecret(JSON.stringify(envelope))).encrypted
}

/** Decrypts and strictly validates a managed OAuth token envelope. */
export async function decryptManagedOAuthTokenSet(
  encryptedTokenSet: string
): Promise<ManagedOAuthTokenSet> {
  try {
    const { decrypted } = await decryptSecret(encryptedTokenSet)
    const parsed: unknown = JSON.parse(decrypted)
    if (!isManagedOAuthTokenSet(parsed)) throw new Error('Invalid managed OAuth token envelope')
    return parsed
  } catch (error) {
    logger.error('Failed to decrypt managed OAuth token set', {
      error: getErrorMessage(error),
    })
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
      'Managed credential token data is invalid',
      500
    )
  }
}

async function getManagedCredential(exec: DbOrTx, credentialId: string, owner?: ResourceOwner) {
  const [row] = await exec
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      providerId: credential.providerId,
      authorizationAppId: credential.authorizationAppId,
      managedOauthScopeVersion: credential.managedOauthScopeVersion,
      managedOauthStatus: credential.managedOauthStatus,
      grantedScopes: credential.grantedScopes,
      encryptedOauthTokenSet: credential.encryptedOauthTokenSet,
      accessTokenExpiresAt: credential.accessTokenExpiresAt,
      refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
      credentialGroupId: credentialGroupEnrollment.credentialGroupId,
      credentialGroupEnrollmentId: credentialGroupEnrollment.id,
      credentialGroupOptionId: credential.credentialGroupOptionId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.type, 'managed_oauth'),
        owner ? resourceScopeCondition(credential, resourceScopeFromOwner(owner)) : undefined
      )
    )
    .limit(1)
  return row ?? null
}

/** Resolves the canonical workspace context for authorization without exposing token material. */
export async function loadManagedOAuthCredentialApplicationContext(
  credentialId: string,
  executingWorkspaceId?: string
): Promise<ManagedOAuthCredentialApplicationContext | null> {
  const row = await getManagedCredential(db, credentialId)
  if (!row) return null
  const workspaceId = executingWorkspaceId ?? row.workspaceId
  if (!workspaceId) return null
  const workspaceContext = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!workspaceContext) return null
  if (
    row.organizationId
      ? row.organizationId !== workspaceContext.workspaceOrganizationId
      : row.workspaceId !== workspaceId
  )
    return null
  return {
    ...workspaceContext,
    ...(row.organizationId ? { organizationId: row.organizationId } : {}),
    credentialId: row.id,
    credentialGroupId: row.credentialGroupId,
    credentialGroupEnrollmentId: row.credentialGroupEnrollmentId,
  }
}

async function assertManagedCredentialUsable(
  row: NonNullable<Awaited<ReturnType<typeof getManagedCredential>>>,
  expectedProviderId: string,
  requiredScopes: string[]
): Promise<CredentialGroupProviderAdapter> {
  if (row.providerId !== expectedProviderId) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_PROVIDER_MISMATCH',
      'Managed credential belongs to a different provider',
      403
    )
  }
  if (row.managedOauthStatus === 'revoked') {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_REVOKED',
      'Managed credential has been revoked',
      401
    )
  }
  if (row.managedOauthStatus !== 'active') {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_NEEDS_REAUTH',
      'Managed credential needs to be authorized again',
      401
    )
  }
  if (!row.authorizationAppId || !row.encryptedOauthTokenSet || !row.grantedScopes) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
      'Managed credential metadata is incomplete',
      500
    )
  }

  const adapter = getCredentialGroupProviderAdapterByProviderId(row.providerId)
  let policy: CredentialGroupProviderPolicy
  try {
    policy = await adapter.getPolicy(undefined, {
      ...resourceScopeFields(resourceScopeFromOwner(row)),
      credentialGroupId: row.credentialGroupId,
      credentialGroupOptionId: row.credentialGroupOptionId ?? undefined,
      authorizationAppId: row.authorizationAppId,
    })
  } catch (error) {
    if (!(error instanceof CredentialGroupProviderConfigurationError)) throw error
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_NEEDS_REAUTH',
      'Managed credential authorization app is unavailable',
      401
    )
  }
  if (
    row.authorizationAppId !== policy.authorizationAppId ||
    row.managedOauthScopeVersion !== policy.scopeVersion
  ) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_NEEDS_REAUTH',
      'Managed credential was authorized with a different OAuth app',
      401
    )
  }

  if (
    (row.grantedScopes.length === 0 && policy.requiredScopes.length > 0) ||
    !adapter.hasRequiredScopes(policy.requiredScopes, requiredScopes) ||
    !adapter.hasRequiredScopes(row.grantedScopes, requiredScopes)
  ) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE',
      'Managed credential is missing one or more required scopes',
      403
    )
  }
  return adapter
}

function hasFreshAccessToken(accessTokenExpiresAt: Date | null, now: Date): boolean {
  return (
    accessTokenExpiresAt === null ||
    accessTokenExpiresAt.getTime() > now.getTime() + ACCESS_TOKEN_REFRESH_WINDOW_MS
  )
}

async function markManagedCredentialNeedsReauth(
  exec: DbOrTx,
  credentialId: string,
  updatedAt: Date
): Promise<void> {
  await exec
    .update(credential)
    .set({ managedOauthStatus: 'needs_reauth', updatedAt })
    .where(and(eq(credential.id, credentialId), eq(credential.managedOauthStatus, 'active')))
}

/** Rechecks rejected tokens through refresh when possible; a concurrent reconnect wins the conditional write. */
export async function rejectManagedOAuthToken(input: {
  credentialId: string
  workspaceId?: string
  organizationId?: string
  expectedProviderId: string
  requiredScopes: string[]
  rejectedAccessToken: string
}): Promise<boolean> {
  const current = await getManagedCredential(db, input.credentialId, input)
  if (
    !current ||
    current.providerId !== input.expectedProviderId ||
    current.managedOauthStatus !== 'active' ||
    !current.encryptedOauthTokenSet
  )
    return false
  const tokenSet = await decryptManagedOAuthTokenSet(current.encryptedOauthTokenSet)
  if (tokenSet.accessToken !== input.rejectedAccessToken) return false
  const updated = await db
    .update(credential)
    .set({
      ...(tokenSet.refreshToken
        ? { accessTokenExpiresAt: new Date(0) }
        : { managedOauthStatus: 'needs_reauth' }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(credential.id, current.id),
        resourceScopeCondition(credential, resourceScopeFromOwner(input)),
        eq(credential.providerId, input.expectedProviderId),
        eq(credential.managedOauthStatus, 'active'),
        eq(credential.encryptedOauthTokenSet, current.encryptedOauthTokenSet)
      )
    )
    .returning({ id: credential.id })
  if (updated.length === 0) return false
  if (!tokenSet.refreshToken) return true
  try {
    await resolveManagedOAuthToken({
      credentialId: input.credentialId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      expectedProviderId: input.expectedProviderId,
      requiredScopes: input.requiredScopes,
    })
    return false
  } catch (error) {
    if (
      error instanceof ManagedOAuthCredentialError &&
      (error.code === 'MANAGED_CREDENTIAL_NEEDS_REAUTH' ||
        error.code === 'MANAGED_CREDENTIAL_REVOKED')
    )
      return true
    if (
      error instanceof ManagedOAuthCredentialError &&
      error.code === 'MANAGED_CREDENTIAL_REFRESH_FAILED'
    )
      return false
    throw error
  }
}

/** Resolves a managed credential ID into a usable token without exposing it to list APIs. */
export async function resolveManagedOAuthToken(
  params: ResolveManagedOAuthTokenParams
): Promise<ResolvedManagedOAuthToken> {
  const initial = await getManagedCredential(db, params.credentialId, params)
  if (!initial) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_NOT_FOUND',
      'Managed credential not found',
      404
    )
  }

  if (!(await isScopedCredentialGroupsAvailable(resourceScopeFromOwner(initial)))) {
    throw new ManagedOAuthCredentialError(
      'MANAGED_CREDENTIAL_UNAVAILABLE',
      'Managed credentials are not available for this workspace',
      403
    )
  }

  try {
    await assertManagedCredentialUsable(initial, params.expectedProviderId, params.requiredScopes)
  } catch (error) {
    if (
      error instanceof ManagedOAuthCredentialError &&
      error.code === 'MANAGED_CREDENTIAL_NEEDS_REAUTH'
    ) {
      await markManagedCredentialNeedsReauth(db, initial.id, new Date())
    }
    throw error
  }
  const initialTokenSet = await decryptManagedOAuthTokenSet(initial.encryptedOauthTokenSet!)
  const now = new Date()
  if (hasFreshAccessToken(initial.accessTokenExpiresAt, now)) {
    return {
      accessToken: initialTokenSet.accessToken,
      ...(initialTokenSet.idToken ? { idToken: initialTokenSet.idToken } : {}),
      refreshed: false,
    }
  }

  const refreshOutcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`managed-oauth:${params.credentialId}`}, 0))`
    )
    const current = await getManagedCredential(tx, params.credentialId, params)
    if (!current) {
      return {
        error: new ManagedOAuthCredentialError(
          'MANAGED_CREDENTIAL_NOT_FOUND',
          'Managed credential not found',
          404
        ),
      }
    }

    let adapter: CredentialGroupProviderAdapter
    try {
      adapter = await assertManagedCredentialUsable(
        current,
        params.expectedProviderId,
        params.requiredScopes
      )
    } catch (error) {
      if (
        error instanceof ManagedOAuthCredentialError &&
        error.code === 'MANAGED_CREDENTIAL_NEEDS_REAUTH'
      ) {
        await markManagedCredentialNeedsReauth(tx, current.id, new Date())
      }
      return {
        error:
          error instanceof ManagedOAuthCredentialError
            ? error
            : new ManagedOAuthCredentialError(
                'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
                'Managed credential metadata is invalid',
                500
              ),
      }
    }

    const currentTokenSet = await decryptManagedOAuthTokenSet(current.encryptedOauthTokenSet!)
    const lockedAt = new Date()
    if (hasFreshAccessToken(current.accessTokenExpiresAt, lockedAt)) {
      return {
        token: {
          accessToken: currentTokenSet.accessToken,
          ...(currentTokenSet.idToken ? { idToken: currentTokenSet.idToken } : {}),
          refreshed: false,
        },
      }
    }

    if (
      !currentTokenSet.refreshToken ||
      (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt <= lockedAt)
    ) {
      await markManagedCredentialNeedsReauth(tx, current.id, lockedAt)
      return {
        error: new ManagedOAuthCredentialError(
          'MANAGED_CREDENTIAL_NEEDS_REAUTH',
          'Managed credential needs to be authorized again',
          401
        ),
      }
    }

    const refreshed = await adapter.refreshToken(currentTokenSet.refreshToken)
    if (!refreshed.ok) {
      const terminal = adapter.isTerminalRefreshError(refreshed.errorCode)
      if (terminal) {
        await markManagedCredentialNeedsReauth(tx, current.id, new Date())
      }
      return {
        error: new ManagedOAuthCredentialError(
          terminal ? 'MANAGED_CREDENTIAL_NEEDS_REAUTH' : 'MANAGED_CREDENTIAL_REFRESH_FAILED',
          terminal
            ? 'Managed credential needs to be authorized again'
            : 'Managed credential refresh failed',
          terminal ? 401 : 502
        ),
      }
    }

    const encryptedOauthTokenSet = await encryptManagedOAuthTokenSet({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      idToken: currentTokenSet.idToken,
    })
    const refreshedAt = new Date()
    const accessTokenExpiresAt = new Date(refreshedAt.getTime() + refreshed.expiresIn * 1000)
    const [updated] = await tx
      .update(credential)
      .set({
        encryptedOauthTokenSet,
        accessTokenExpiresAt,
        lastRefreshedAt: refreshedAt,
        updatedAt: refreshedAt,
      })
      .where(and(eq(credential.id, current.id), eq(credential.managedOauthStatus, 'active')))
      .returning({ id: credential.id })
    if (!updated) {
      return {
        error: new ManagedOAuthCredentialError(
          'MANAGED_CREDENTIAL_NEEDS_REAUTH',
          'Managed credential changed while its token was refreshing',
          401
        ),
      }
    }

    return {
      token: {
        accessToken: refreshed.accessToken,
        ...(currentTokenSet.idToken ? { idToken: currentTokenSet.idToken } : {}),
        refreshed: true,
      },
    }
  })

  if ('error' in refreshOutcome && refreshOutcome.error) throw refreshOutcome.error
  if ('token' in refreshOutcome && refreshOutcome.token) return refreshOutcome.token
  throw new ManagedOAuthCredentialError(
    'MANAGED_CREDENTIAL_REFRESH_FAILED',
    'Managed credential refresh returned no token',
    500
  )
}
