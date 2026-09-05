import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  encryptPersonalToken,
  verifyGitLabPersonalToken,
} from '@/lib/credentials/gitlab-personal-token'
import type { CredentialRow } from '@/lib/credentials/queries'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

export interface PersonalTokenCredential {
  id: string
  providerId: string
  displayName: string
  type: 'personal_token'
  instanceUrl: string
}

/** Lists only the acting person's live tokens, without loading secret material or shared grants. */
export async function getPersonalTokenCredentials(
  workspaceId: string,
  userId: string
): Promise<PersonalTokenCredential[]> {
  const rows = await db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      instanceUrl: credential.providerTenantId,
    })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'personal_token'),
        eq(credential.createdBy, userId),
        isNull(credential.revokedAt),
        or(isNull(credential.accessTokenExpiresAt), gt(credential.accessTokenExpiresAt, new Date()))
      )
    )
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
  const verified = await verifyGitLabPersonalToken(input.apiToken, input.domain)
  const encryptedPersonalToken = await encryptPersonalToken({
    providerId: verified.providerId,
    ownerUserId: input.userId,
    workspaceId: input.workspaceId,
    subjectId: verified.subjectId,
    instanceUrl: verified.instanceUrl,
    accessToken: input.apiToken,
  })
  const values = {
    type: 'personal_token' as const,
    workspaceId: input.workspaceId,
    createdBy: input.userId,
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
        grantedScopes: verified.grantedScopes,
        accessTokenExpiresAt: verified.expiresAt,
        revokedAt: null,
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
    !current.createdBy ||
    !current.providerTenantId ||
    !current.providerSubjectId ||
    current.providerId !== 'gitlab'
  )
    throw new Error('Personal token identity is incomplete')
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
    updatedFields.push('apiToken')
  }
  const [updated] = await db
    .update(credential)
    .set(updates)
    .where(
      and(
        eq(credential.id, current.id),
        eq(credential.type, 'personal_token'),
        eq(credential.createdBy, current.createdBy)
      )
    )
    .returning()
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
