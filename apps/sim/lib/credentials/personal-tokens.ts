import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
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
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .innerJoin(workspace, eq(workspace.id, workspaceId))
    .where(
      and(
        or(
          eq(credential.workspaceId, workspaceId),
          and(
            eq(credential.organizationId, workspace.organizationId),
            isNull(credential.workspaceId)
          )
        ),
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
    or(
      and(eq(credentialGroup.workspaceId, workspaceId), isNull(credentialGroup.organizationId)),
      and(
        eq(credentialGroup.organizationId, workspace.organizationId),
        isNull(credentialGroup.workspaceId)
      )
    ),
    eq(credentialGroup.status, 'active'),
    eq(user.id, userId),
    eq(user.emailVerified, true),
    or(
      isNull(credentialGroup.organizationId),
      sql`exists (select 1 from ${member} where ${member.organizationId} = ${credentialGroup.organizationId} and ${member.userId} = ${userId})`
    ),
    inArray(credentialGroupEnrollment.status, ['invited', 'in_progress', 'completed']),
    isNull(credentialGroupEnrollment.revokedAt),
  ]
}

/** Rechecks the canonical group and the verified person behind a bound token before every use. */
export async function requirePersonalTokenEnrollment(
  input: ResourceOwner & { userId: string; enrollmentId: string | null },
  executor: DbOrTx = db,
  lock = false
): Promise<void> {
  const scope = resourceScopeFromOwner(input)
  if (!input.enrollmentId)
    throw new OrchestrationError(
      'forbidden',
      'Reconnect your personal account in Connected accounts'
    )
  if (lock) await lockCredentialGroupEnrollmentLifecycle(executor, input.enrollmentId)
  const query = executor
    .select({
      id: credentialGroupEnrollment.id,
      credentialGroupId: credentialGroup.id,
      organizationId: credentialGroup.organizationId,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .leftJoin(
      workspace,
      scope.kind === 'workspace' ? eq(workspace.id, scope.workspaceId) : sql`false`
    )
    .where(
      and(
        eq(credentialGroupEnrollment.id, input.enrollmentId),
        ...(scope.kind === 'workspace'
          ? liveEnrollmentConditions(scope.workspaceId, input.userId)
          : [
              resourceScopeCondition(credentialGroup, scope),
              eq(credentialGroup.status, 'active'),
              eq(user.id, input.userId),
              eq(user.emailVerified, true),
              inArray(credentialGroupEnrollment.status, ['invited', 'in_progress', 'completed']),
              isNull(credentialGroupEnrollment.revokedAt),
              sql`exists (select 1 from ${member} where ${member.organizationId} = ${scope.organizationId} and ${member.userId} = ${input.userId})`,
            ])
      )
    )
    .limit(1)
  const [binding] = await (lock
    ? query.for('share', { of: [credentialGroupEnrollment, credentialGroup, user] })
    : query)
  if (!binding)
    throw new OrchestrationError(
      'forbidden',
      'Your personal account is no longer available in Connected accounts'
    )
  if (binding.organizationId) {
    await requireOrganizationAccountsSetup(
      binding.organizationId,
      binding.credentialGroupId,
      executor
    )
  }
}

export interface CreatePersonalTokenParams {
  userId: string
  accounts: { organizationId: string; credentialGroupId: string }
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
  const verified = await verifyGitLabPersonalToken(input.apiToken, input.domain)
  const encryptedPersonalToken = await encryptPersonalToken({
    providerId: verified.providerId,
    ownerUserId: input.userId,
    organizationId: input.accounts.organizationId,
    subjectId: verified.subjectId,
    instanceUrl: verified.instanceUrl,
    accessToken: input.apiToken,
  })
  const { enrollment } = await createViewerCredentialGroupEnrollment({
    userId: input.userId,
    organizationId: input.accounts.organizationId,
    credentialGroupId: input.accounts.credentialGroupId,
  })
  const values = {
    type: 'personal_token' as const,
    organizationId: input.accounts.organizationId,
    workspaceId: null,
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
      {
        organizationId: input.accounts.organizationId,
        userId: input.userId,
        enrollmentId: enrollment.id,
      },
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
          credential.organizationId,
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
          eq(credential.organizationId, input.accounts.organizationId),
          isNull(credential.workspaceId),
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
    !current.createdBy ||
    !current.providerTenantId ||
    !current.providerSubjectId ||
    current.providerId !== 'gitlab'
  )
    throw new Error('Personal token identity is incomplete')
  const {
    createdBy: ownerUserId,
    providerTenantId: instanceUrl,
    providerSubjectId: subjectId,
  } = current
  const scope = resourceScopeFromOwner(current)
  const enrollmentBinding = {
    ...resourceScopeFields(scope),
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
      ...resourceScopeFields(scope),
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
          resourceScopeCondition(credential, scope),
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
