import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, ne, sql } from 'drizzle-orm'
import {
  type CredentialGroupOAuthContext,
  lockCredentialGroupEnrollmentLifecycle,
} from '@/lib/credential-groups/enrollments'
import {
  type CredentialGroupOAuthAttempt,
  createCredentialGroupOAuthAttempt,
} from '@/lib/credential-groups/oauth-state'
import { requireCredentialGroupOAuthOptionConfig } from '@/lib/credential-groups/option-config'
import type {
  CredentialGroupProviderAdapter,
  CredentialGroupProviderPolicy,
  VerifiedCredentialGroupGrant,
} from '@/lib/credential-groups/provider-adapter'
import {
  CredentialGroupInvitationUnavailableError,
  CredentialGroupOAuthError,
} from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import {
  decryptManagedOAuthTokenSet,
  encryptManagedOAuthTokenSet,
} from '@/lib/credentials/managed-oauth'

function scopesEqual(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort()
  const normalizedRight = [...new Set(right)].sort()
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((scope, index) => scope === normalizedRight[index])
  )
}

function policiesEqual(
  left: CredentialGroupProviderPolicy,
  right: CredentialGroupProviderPolicy
): boolean {
  return (
    left.provider === right.provider &&
    left.providerId === right.providerId &&
    left.authorizationAppId === right.authorizationAppId &&
    left.scopeVersion === right.scopeVersion &&
    scopesEqual(left.requiredScopes, right.requiredScopes)
  )
}

function getOptionAdapter(context: CredentialGroupOAuthContext): CredentialGroupProviderAdapter {
  if (!isCredentialGroupProvider(context.option.provider)) {
    throw new Error(`Unsupported Credential Group provider: ${context.option.provider}`)
  }
  return getCredentialGroupProviderAdapter(context.option.provider)
}

async function assertCurrentPolicy(
  context: CredentialGroupOAuthContext,
  adapter: CredentialGroupProviderAdapter,
  attempt?: CredentialGroupOAuthAttempt
): Promise<CredentialGroupProviderPolicy> {
  const policy = await adapter.getPolicy(requireCredentialGroupOAuthOptionConfig(context.option), {
    workspaceId: context.workspaceId,
    credentialGroupId: context.credentialGroupId,
  })
  const optionMatches = context.option.provider === policy.provider
  const attemptMatches =
    !attempt ||
    (attempt.provider === policy.provider &&
      attempt.authorizationAppId === policy.authorizationAppId &&
      attempt.scopeVersion === policy.scopeVersion &&
      scopesEqual(attempt.requiredScopes, policy.requiredScopes))
  if (!optionMatches || !attemptMatches) {
    throw new CredentialGroupOAuthError(
      'This credential option changed. Reload the invitation and try again.',
      409
    )
  }
  return policy
}

/** Builds a provider authorization URL after persisting a provider-bound one-time attempt. */
export async function startCredentialGroupOAuth(
  context: CredentialGroupOAuthContext,
  invitationToken: string
): Promise<string> {
  const adapter = getOptionAdapter(context)
  const policy = await assertCurrentPolicy(context, adapter)
  const prepared = await adapter.prepareAuthorization(context, policy)
  const { state, nonce } = await createCredentialGroupOAuthAttempt({
    provider: policy.provider,
    enrollmentId: context.enrollmentId,
    credentialGroupId: context.credentialGroupId,
    optionId: context.option.id,
    authorizationAppId: policy.authorizationAppId,
    scopeVersion: policy.scopeVersion,
    requiredScopes: policy.requiredScopes,
    redirectUri: prepared.redirectUri,
    codeVerifier: prepared.codeVerifier,
    invitationToken,
  })
  return await prepared.buildAuthorizationUrl({ state, nonce })
}

async function persistGrant(
  context: CredentialGroupOAuthContext,
  adapter: CredentialGroupProviderAdapter,
  policy: CredentialGroupProviderPolicy,
  grant: VerifiedCredentialGroupGrant
): Promise<void> {
  if (grant.providerId !== policy.providerId) {
    throw new CredentialGroupOAuthError('Provider returned a credential for another app.', 502)
  }

  await db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, context.enrollmentId)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credential-group-oauth:${context.enrollmentId}:${context.option.id}`}, 0))`
    )
    const [enrollment] = await tx
      .select({ status: credentialGroupEnrollment.status })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.id, context.enrollmentId))
      .limit(1)
    if (!enrollment || enrollment.status === 'revoked') {
      throw new CredentialGroupInvitationUnavailableError()
    }

    const [group] = await tx
      .select({ status: credentialGroup.status, options: credentialGroup.options })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, context.credentialGroupId),
          eq(credentialGroup.workspaceId, context.workspaceId)
        )
      )
      .limit(1)
      .for('update')
    const currentOption = group?.options.find((option) => option.id === context.option.id)
    if (
      !group ||
      group.status !== 'active' ||
      !currentOption ||
      currentOption.status !== 'active' ||
      currentOption.provider !== adapter.provider
    ) {
      throw new CredentialGroupOAuthError(
        'This credential option changed. Reload the invitation and try again.',
        409
      )
    }
    const currentPolicy = await adapter.getPolicy(
      requireCredentialGroupOAuthOptionConfig(currentOption),
      {
        workspaceId: context.workspaceId,
        credentialGroupId: context.credentialGroupId,
        executor: tx,
      }
    )
    if (!policiesEqual(currentPolicy, policy)) {
      throw new CredentialGroupOAuthError(
        'This credential option changed. Reload the invitation and try again.',
        409
      )
    }

    const [existing] = await tx
      .select({
        id: credential.id,
        providerSubjectId: credential.providerSubjectId,
        encryptedOauthTokenSet: credential.encryptedOauthTokenSet,
        refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
      })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_oauth'),
          eq(credential.credentialGroupEnrollmentId, context.enrollmentId),
          eq(credential.credentialGroupOptionId, context.option.id)
        )
      )
      .limit(1)

    let refreshToken = grant.refreshToken
    if (
      !refreshToken &&
      existing?.providerSubjectId === grant.providerSubjectId &&
      existing.encryptedOauthTokenSet
    ) {
      refreshToken = (await decryptManagedOAuthTokenSet(existing.encryptedOauthTokenSet))
        .refreshToken
    }
    if (adapter.requiresRefreshToken && !refreshToken) {
      const service = getCredentialGroupProviderService(policy.provider)
      throw new CredentialGroupOAuthError(
        `${service.name} did not issue offline access. Remove Sim from the provider and try again.`,
        409
      )
    }

    const encryptedOauthTokenSet = await encryptManagedOAuthTokenSet({
      accessToken: grant.accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    })
    const now = new Date()
    const service = getCredentialGroupProviderService(policy.provider)
    const values = {
      workspaceId: context.workspaceId,
      type: 'managed_oauth' as const,
      displayName: grant.displayName,
      description: `Managed ${service.name} account for ${context.workspaceName}`,
      providerId: policy.providerId,
      accountId: null,
      authorizationAppId: policy.authorizationAppId,
      credentialGroupEnrollmentId: context.enrollmentId,
      credentialGroupOptionId: context.option.id,
      managedOauthScopeVersion: policy.scopeVersion,
      providerSubjectId: grant.providerSubjectId,
      providerTenantId: grant.providerTenantId,
      managedOauthStatus: 'active' as const,
      grantedScopes: grant.grantedScopes,
      providerMetadata: grant.metadata,
      encryptedOauthTokenSet,
      grantedAt: now,
      revokedAt: null,
      accessTokenExpiresAt: grant.accessTokenExpiresAt,
      refreshTokenExpiresAt: grant.refreshTokenExpiresAt ?? existing?.refreshTokenExpiresAt ?? null,
      lastRefreshedAt: null,
      updatedAt: now,
    }

    if (existing) {
      const [updated] = await tx
        .update(credential)
        .set(values)
        .where(eq(credential.id, existing.id))
        .returning({ id: credential.id })
      if (!updated) throw new Error('Managed OAuth credential update returned no row')
    } else {
      const [inserted] = await tx
        .insert(credential)
        .values({
          id: generateId(),
          ...values,
          createdBy: context.workspaceOwnerId,
          createdAt: now,
        })
        .returning({ id: credential.id })
      if (!inserted) throw new Error('Managed OAuth credential insert returned no row')
    }

    const [updatedEnrollment] = await tx
      .update(credentialGroupEnrollment)
      .set({
        status: enrollment.status === 'completed' ? 'completed' : 'in_progress',
        ...(enrollment.status === 'completed' ? {} : { completedAt: null }),
        updatedAt: now,
      })
      .where(
        and(
          eq(credentialGroupEnrollment.id, context.enrollmentId),
          ne(credentialGroupEnrollment.status, 'revoked')
        )
      )
      .returning({ id: credentialGroupEnrollment.id })
    if (!updatedEnrollment) {
      throw new CredentialGroupInvitationUnavailableError()
    }
  })
}

/** Exchanges a single-use code through its provider adapter and persists a normalized grant. */
export async function completeCredentialGroupOAuth(
  context: CredentialGroupOAuthContext,
  attempt: CredentialGroupOAuthAttempt,
  code: string
): Promise<void> {
  if (
    attempt.enrollmentId !== context.enrollmentId ||
    attempt.credentialGroupId !== context.credentialGroupId ||
    attempt.optionId !== context.option.id ||
    attempt.provider !== context.option.provider
  ) {
    throw new CredentialGroupOAuthError('Authorization state is invalid or expired.', 400)
  }
  const adapter = getOptionAdapter(context)
  const policy = await assertCurrentPolicy(context, adapter, attempt)
  const grant = await adapter.exchangeAndVerify({ context, attempt, code, policy })
  await persistGrant(context, adapter, policy, grant)
}
