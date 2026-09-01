import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, ne, sql } from 'drizzle-orm'
import {
  type CredentialGroupApiKeyVerification,
  CredentialGroupApiKeyVerificationError,
} from '@/lib/credential-groups/api-key-providers/types'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import {
  CredentialGroupInvitationUnavailableError,
  CredentialGroupOAuthError,
} from '@/lib/credential-groups/provider-adapter'
import {
  type CredentialGroupApiKeyProvider,
  getCredentialGroupProviderId,
  getCredentialGroupProviderPresentation,
} from '@/lib/credential-groups/providers'
import { sealManagedApiKey } from '@/lib/credentials/managed-api-key'

/**
 * Stores a verified API key against one enrollment option.
 *
 * Mirrors the OAuth grant path's locking exactly — the same lifecycle lock, an option-scoped
 * advisory lock, and a `FOR UPDATE` re-read of the group — because the races are the same:
 * a revocation landing mid-submit, and two submissions for one option colliding.
 */
export async function persistCredentialGroupApiKey(params: {
  context: CredentialGroupOAuthContext
  provider: CredentialGroupApiKeyProvider
  fields: Record<string, string>
  verification: CredentialGroupApiKeyVerification
}): Promise<void> {
  const { context, provider, fields, verification } = params

  /**
   * Where the service can name the key's owner, hold it to the same rule the OAuth path
   * enforces: the credential must belong to the person the invitation was sent to. Where it
   * cannot, the binding rests on possession of the invitation link, and the option is
   * recorded without an address rather than with an unverified one.
   */
  if (verification.identity === 'verified') {
    const grantedEmail = normalizeEmail(verification.email)
    if (grantedEmail !== context.email) {
      throw new CredentialGroupOAuthError(
        `This key belongs to ${grantedEmail}. Use the key for ${context.email}.`,
        403
      )
    }
  }

  const encryptedApiKey = await sealManagedApiKey(fields)
  const providerId = getCredentialGroupProviderId(provider)
  const providerName = getCredentialGroupProviderPresentation(provider).name

  await db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, context.enrollmentId)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credential-group-api-key:${context.enrollmentId}:${context.option.id}`}, 0))`
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
      currentOption.provider !== provider
    ) {
      throw new CredentialGroupOAuthError(
        'This credential option changed. Reload the invitation and try again.',
        409
      )
    }

    const [existing] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_api_key'),
          eq(credential.credentialGroupEnrollmentId, context.enrollmentId),
          eq(credential.credentialGroupOptionId, context.option.id)
        )
      )
      .limit(1)

    const now = new Date()
    const values = {
      workspaceId: context.workspaceId,
      type: 'managed_api_key' as const,
      displayName: verification.displayName,
      description: `Managed ${providerName} key for ${context.workspaceName}`,
      providerId,
      accountId: null,
      credentialGroupEnrollmentId: context.enrollmentId,
      credentialGroupOptionId: context.option.id,
      providerSubjectId: verification.subjectId,
      providerTenantId: null,
      managedOauthStatus: 'active' as const,
      providerMetadata:
        verification.identity === 'verified'
          ? { email: verification.email, displayName: verification.displayName }
          : { displayName: verification.displayName },
      encryptedApiKey,
      grantedAt: now,
      revokedAt: null,
      updatedAt: now,
    }

    if (existing) {
      const [updated] = await tx
        .update(credential)
        .set(values)
        .where(eq(credential.id, existing.id))
        .returning({ id: credential.id })
      if (!updated) throw new Error('Managed API key credential update returned no row')
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
      if (!inserted) throw new Error('Managed API key credential insert returned no row')
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
    if (!updatedEnrollment) throw new CredentialGroupInvitationUnavailableError()
  })
}

export { CredentialGroupApiKeyVerificationError }
