import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  foldedEmail,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadWorkspaceAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import {
  encryptPersonalToken,
  verifyGitLabPersonalToken,
} from '@/lib/credentials/gitlab-personal-token'
import type { CredentialRow } from '@/lib/credentials/queries'
import type { DbOrTx } from '@/lib/db/types'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

export interface PersonalTokenCredential {
  id: string
  providerId: string
  displayName: string
  type: 'personal_token'
  instanceUrl: string
  updatedAt: Date
  connectedAt: Date
}

/** Lists only the acting person's live tokens, without loading secret material or shared grants. */
export async function getPersonalTokenCredentials(
  workspaceId: string,
  userId: string,
  credentialId?: string
): Promise<PersonalTokenCredential[]> {
  const query = db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      instanceUrl: credential.providerTenantId,
      updatedAt: credential.updatedAt,
      connectedAt: sql`coalesce(${credential.grantedAt}, ${credential.createdAt})`.mapWith(
        credential.createdAt
      ),
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(
      user,
      and(
        eq(user.id, credential.createdBy),
        eq(foldedEmail(user.email), credentialGroupEnrollment.email)
      )
    )
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'personal_token'),
        credentialId === undefined ? undefined : eq(credential.id, credentialId),
        eq(credential.createdBy, userId),
        ...liveEnrollmentConditions(workspaceId, userId),
        isNull(credential.revokedAt),
        or(isNull(credential.accessTokenExpiresAt), gt(credential.accessTokenExpiresAt, new Date()))
      )
    )
  const rows = await (credentialId === undefined ? query : query.limit(1))
  return rows.flatMap((row) =>
    row.providerId && row.instanceUrl
      ? [
          {
            ...row,
            providerId: row.providerId,
            instanceUrl: row.instanceUrl,
            type: 'personal_token' as const,
          },
        ]
      : []
  )
}

function liveEnrollmentConditions(workspaceId: string, userId: string) {
  return [
    eq(credentialGroup.workspaceId, workspaceId),
    eq(credentialGroup.status, 'active'),
    eq(user.id, userId),
    eq(user.emailVerified, true),
    inArray(credentialGroupEnrollment.status, ['invited', 'in_progress', 'completed']),
    isNull(credentialGroupEnrollment.revokedAt),
  ]
}

/** Rechecks the canonical group and the verified person behind a bound token before every use. */
export async function requirePersonalTokenEnrollment(
  input: { workspaceId: string; userId: string; enrollmentId: string | null },
  executor: DbOrTx = db,
  lock = false
): Promise<void> {
  if (!input.enrollmentId)
    throw new OrchestrationError(
      'forbidden',
      'Reconnect your personal account in Connected accounts'
    )
  if (lock) await lockCredentialGroupEnrollmentLifecycle(executor, input.enrollmentId)
  const query = executor
    .select({ id: credentialGroupEnrollment.id })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(user, eq(foldedEmail(user.email), credentialGroupEnrollment.email))
    .where(
      and(
        eq(credentialGroupEnrollment.id, input.enrollmentId),
        ...liveEnrollmentConditions(input.workspaceId, input.userId)
      )
    )
    .limit(1)
  const [binding] = await (lock ? query.for('share') : query)
  if (!binding)
    throw new OrchestrationError(
      'forbidden',
      'Your personal account is no longer available in Connected accounts'
    )
}

export interface CreatePersonalTokenParams {
  workspaceId: string
  userId: string
  providerId?: string
  apiToken?: string
  domain?: string
  displayName?: string
  description?: string
}

/** Stores a verified personal token in its immutable owner/provider/instance/subject slot. */
export async function createPersonalTokenCredential(input: CreatePersonalTokenParams) {
  if (input.providerId !== 'gitlab' || !input.apiToken)
    throw new OrchestrationError('validation', 'A personal GitLab access token is required')
  const group = await loadWorkspaceAccountsCredentialListContext(input.workspaceId)
  if (!group || group.status !== 'active')
    throw new OrchestrationError(
      'forbidden',
      'Connected accounts is not available in this workspace'
    )
  const verified = await verifyGitLabPersonalToken(input.apiToken, input.domain)
  const encryptedPersonalToken = await encryptPersonalToken({
    providerId: verified.providerId,
    ownerUserId: input.userId,
    workspaceId: input.workspaceId,
    subjectId: verified.subjectId,
    instanceUrl: verified.instanceUrl,
    accessToken: input.apiToken,
  })
  const { enrollment } = await createViewerCredentialGroupEnrollment({
    userId: input.userId,
    workspaceId: input.workspaceId,
    credentialGroupId: group.credentialGroupId,
  })
  const values = {
    type: 'personal_token' as const,
    workspaceId: input.workspaceId,
    createdBy: input.userId,
    credentialGroupEnrollmentId: enrollment.id,
    providerId: verified.providerId,
    providerSubjectId: verified.subjectId,
    providerTenantId: verified.instanceUrl,
    encryptedPersonalToken,
    grantedScopes: verified.grantedScopes,
    accessTokenExpiresAt: verified.expiresAt,
    displayName: input.displayName ?? verified.displayName,
    description: input.description ?? null,
    grantedAt: new Date(),
    updatedAt: new Date(),
  }
  return db.transaction(async (tx) => {
    await requirePersonalTokenEnrollment(
      { workspaceId: input.workspaceId, userId: input.userId, enrollmentId: enrollment.id },
      tx,
      true
    )
    await tx
      .update(credentialGroupEnrollment)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(
        and(
          eq(credentialGroupEnrollment.id, enrollment.id),
          inArray(credentialGroupEnrollment.status, ['invited', 'delivery_failed'])
        )
      )
    const [created] = await tx
      .insert(credential)
      .values({ id: generateId(), ...values })
      .onConflictDoNothing({
        target: [
          credential.workspaceId,
          credential.createdBy,
          credential.providerId,
          credential.providerTenantId,
          credential.providerSubjectId,
        ],
        where: sql`type = 'personal_token'`,
      })
      .returning()
    if (created)
      return {
        credential: created,
        created: true,
        success: true as const,
        auditMetadata: { providerSubjectId: verified.subjectId, instanceUrl: verified.instanceUrl },
      }
    const [updated] = await tx
      .update(credential)
      .set({
        encryptedPersonalToken,
        credentialGroupEnrollmentId: enrollment.id,
        grantedScopes: verified.grantedScopes,
        accessTokenExpiresAt: verified.expiresAt,
        revokedAt: null,
        grantedAt: new Date(),
        updatedAt: new Date(),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      })
      .where(
        and(
          eq(credential.workspaceId, input.workspaceId),
          eq(credential.type, 'personal_token'),
          eq(credential.createdBy, input.userId),
          eq(credential.providerId, 'gitlab'),
          eq(credential.providerTenantId, verified.instanceUrl),
          eq(credential.providerSubjectId, verified.subjectId)
        )
      )
      .returning()
    if (!updated) throw new Error('Personal token disappeared while connecting')
    return {
      credential: updated,
      created: false,
      success: true as const,
      auditMetadata: { providerSubjectId: verified.subjectId, instanceUrl: verified.instanceUrl },
    }
  })
}

export interface UpdatePersonalTokenParams {
  credential: CredentialRow
  displayName?: string
  description?: string | null
  apiToken?: string
  domain?: string
}

/** Rotation cannot change the person or instance behind a credential used by earlier turns. */
export async function updatePersonalTokenCredential(input: UpdatePersonalTokenParams) {
  const current = input.credential
  if (
    !current.workspaceId ||
    !current.createdBy ||
    !current.providerTenantId ||
    !current.providerSubjectId ||
    current.providerId !== 'gitlab'
  )
    throw new Error('Personal token identity is incomplete')
  const {
    workspaceId,
    createdBy: ownerUserId,
    providerTenantId: instanceUrl,
    providerSubjectId: subjectId,
  } = current
  const enrollmentBinding = {
    workspaceId: current.workspaceId,
    userId: ownerUserId,
    enrollmentId: current.credentialGroupEnrollmentId,
  }
  await requirePersonalTokenEnrollment(enrollmentBinding)
  const updatedFields: string[] = []
  const updates: Partial<typeof credential.$inferInsert> = { updatedAt: new Date() }
  if (input.displayName !== undefined) {
    updates.displayName = input.displayName
    updatedFields.push('displayName')
  }
  if (input.description !== undefined) {
    updates.description = input.description
    updatedFields.push('description')
  }
  if (
    input.domain &&
    new URL(`https://${normalizeGitLabHost(input.domain)}`).origin !== current.providerTenantId
  )
    throw new OrchestrationError(
      'validation',
      'Connect a new personal token to use another GitLab instance'
    )
  if (input.apiToken) {
    const verified = await verifyGitLabPersonalToken(input.apiToken, current.providerTenantId)
    if (
      verified.subjectId !== current.providerSubjectId ||
      verified.instanceUrl !== current.providerTenantId
    )
      throw new OrchestrationError(
        'validation',
        'Use a token for the same GitLab account and instance, or connect a new account'
      )
    updates.encryptedPersonalToken = await encryptPersonalToken({
      providerId: 'gitlab',
      ownerUserId: current.createdBy,
      workspaceId: current.workspaceId,
      subjectId: current.providerSubjectId,
      instanceUrl: current.providerTenantId,
      accessToken: input.apiToken,
    })
    updates.grantedScopes = verified.grantedScopes
    updates.accessTokenExpiresAt = verified.expiresAt
    updates.revokedAt = null
    updates.grantedAt = new Date()
    updatedFields.push('apiToken')
  }
  const updated = await db.transaction(async (tx) => {
    await requirePersonalTokenEnrollment(enrollmentBinding, tx, true)
    const [updated] = await tx
      .update(credential)
      .set(updates)
      .where(
        and(
          eq(credential.id, current.id),
          eq(credential.type, 'personal_token'),
          eq(credential.createdBy, ownerUserId),
          eq(credential.workspaceId, workspaceId),
          eq(credential.providerTenantId, instanceUrl),
          eq(credential.providerSubjectId, subjectId)
        )
      )
      .returning()
    return updated
  })
  if (!updated) throw new OrchestrationError('not_found', 'Credential not found')
  return {
    success: true as const,
    updatedFields,
    auditMetadata: {
      providerSubjectId: current.providerSubjectId,
      instanceUrl: current.providerTenantId,
    },
  }
}
