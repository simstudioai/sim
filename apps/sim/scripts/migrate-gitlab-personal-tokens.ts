#!/usr/bin/env bun

/**
 * Rebinds workspace GitLab tokens to their organization's existing Connected accounts group.
 * Run after the organization-token application code is fully deployed. Defaults to dry-run:
 * bun run scripts/migrate-gitlab-personal-tokens.ts --organization-id=<id> [--apply]
 * Uses the configured database and encryption key. No provider requests or invitation emails.
 */
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { decryptPersonalToken, encryptPersonalToken } from '@/lib/credentials/gitlab-personal-token'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('MigrateGitLabPersonalTokens')
const BATCH_SIZE = 100

interface MigrationOptions {
  organizationId: string
  apply: boolean
}

function organizationTokens(organizationId: string) {
  return and(
    eq(credential.type, 'personal_token'),
    or(eq(credential.organizationId, organizationId), eq(workspace.organizationId, organizationId))
  )
}

/** Refuses to choose between independently connected tokens for the same provider identity. */
async function assertUniqueIdentities(executor: DbOrTx, organizationId: string) {
  const duplicates = await executor
    .select({ userId: credential.createdBy })
    .from(credential)
    .leftJoin(workspace, eq(workspace.id, credential.workspaceId))
    .where(organizationTokens(organizationId))
    .groupBy(
      credential.createdBy,
      credential.providerId,
      credential.providerTenantId,
      credential.providerSubjectId
    )
    .having(sql`count(*) > 1`)
    .limit(1)
  if (duplicates.length)
    throw new Error(
      'Duplicate GitLab identities exist in this organization. Resolve the duplicate connections before migrating.'
    )
}

async function migrateToken(executor: DbOrTx, credentialId: string, options: MigrationOptions) {
  const [initial] = await executor
    .select()
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  if (!initial) throw new Error('Migration credential disappeared')
  if (initial.organizationId === options.organizationId && !initial.workspaceId) return false
  if (!initial.credentialGroupEnrollmentId)
    throw new Error(`Credential ${credentialId} requires a verified enrollment before migration`)
  await lockCredentialGroupEnrollmentLifecycle(executor, initial.credentialGroupEnrollmentId)
  const [current] = await executor
    .select()
    .from(credential)
    .where(eq(credential.id, credentialId))
    .for('update')
    .limit(1)
  if (!current) throw new Error('Migration credential disappeared')
  if (current.organizationId === options.organizationId && !current.workspaceId) return false
  if (current.credentialGroupEnrollmentId !== initial.credentialGroupEnrollmentId)
    throw new Error('Enrollment changed during migration; retry the command')
  if (
    current.type !== 'personal_token' ||
    current.providerId !== 'gitlab' ||
    !current.workspaceId ||
    current.organizationId ||
    !current.createdBy ||
    !current.providerSubjectId ||
    !current.providerTenantId ||
    !current.encryptedPersonalToken
  ) {
    throw new Error(`Credential ${credentialId} has an incomplete personal-token identity`)
  }
  const [sourceWorkspace] = await executor
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, current.workspaceId))
    .for('share')
    .limit(1)
  if (sourceWorkspace?.organizationId !== options.organizationId)
    throw new Error('Workspace organization changed during migration')
  const [owner] = await executor
    .select({ id: user.id, email: user.email, verified: user.emailVerified })
    .from(user)
    .innerJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, options.organizationId))
    )
    .where(eq(user.id, current.createdBy))
    .for('share')
    .limit(1)
  if (!owner?.verified)
    throw new Error(`Credential ${credentialId} requires a verified current organization member`)
  const [source] = await executor
    .select({
      userId: credentialGroupEnrollment.userId,
      status: credentialGroupEnrollment.status,
      revokedAt: credentialGroupEnrollment.revokedAt,
      workspaceId: credentialGroup.workspaceId,
      organizationId: credentialGroup.organizationId,
      groupStatus: credentialGroup.status,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(eq(credentialGroupEnrollment.id, current.credentialGroupEnrollmentId!))
    .for('share')
    .limit(1)
  if (
    !source ||
    source.userId !== current.createdBy ||
    source.revokedAt ||
    source.status === 'revoked' ||
    source.groupStatus !== 'active' ||
    !(
      source.workspaceId === current.workspaceId ||
      (source.organizationId === options.organizationId && !source.workspaceId)
    )
  ) {
    throw new Error(`Credential ${credentialId} has an inactive or mismatched source enrollment`)
  }
  const [group] = await executor
    .select({ id: credentialGroup.id })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.organizationId, options.organizationId),
        isNull(credentialGroup.workspaceId),
        eq(credentialGroup.status, 'active')
      )
    )
    .for('share')
    .limit(1)
  if (!group) throw new Error('Configure organization Connected accounts before migrating tokens')
  await requireOrganizationAccountsSetup(options.organizationId, group.id, executor)

  const targets = await executor
    .select()
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, group.id),
        or(
          eq(credentialGroupEnrollment.userId, owner.id),
          eq(credentialGroupEnrollment.email, normalizeEmail(owner.email))
        )
      )
    )
    .for('update')
    .limit(2)
  if (targets.length > 1)
    throw new Error(`Credential ${credentialId} has conflicting organization enrollment identities`)
  const [target] = targets
  if (
    target &&
    (target.revokedAt ||
      target.status === 'revoked' ||
      (target.userId && target.userId !== owner.id))
  ) {
    throw new Error(
      `Credential ${credentialId} has a revoked or conflicting organization enrollment`
    )
  }
  const [duplicate] = await executor
    .select({ id: credential.id })
    .from(credential)
    .leftJoin(workspace, eq(workspace.id, credential.workspaceId))
    .where(
      and(
        organizationTokens(options.organizationId),
        ne(credential.id, current.id),
        eq(credential.createdBy, owner.id),
        eq(credential.providerId, 'gitlab'),
        eq(credential.providerTenantId, current.providerTenantId),
        eq(credential.providerSubjectId, current.providerSubjectId)
      )
    )
    .limit(1)
  if (duplicate)
    throw new Error(
      'Duplicate GitLab identity appeared during migration; resolve it before retrying'
    )
  const identity = {
    providerId: 'gitlab' as const,
    ownerUserId: owner.id,
    subjectId: current.providerSubjectId,
    instanceUrl: current.providerTenantId,
  }
  const accessToken = await decryptPersonalToken(current.encryptedPersonalToken, {
    ...identity,
    workspaceId: current.workspaceId,
  })
  if (!options.apply) return true
  const encryptedPersonalToken = await encryptPersonalToken({
    ...identity,
    organizationId: options.organizationId,
    accessToken,
  })
  const now = new Date()
  const enrollmentId = target?.id ?? generateId()
  if (!target) {
    await executor.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group.id,
      userId: owner.id,
      email: normalizeEmail(owner.email),
      status: 'in_progress',
      invitationTokenHash: sha256Hex(generateId()),
      invitationExpiresAt: now,
      invitedAt: now,
    })
  } else if (!target.userId) {
    await executor
      .update(credentialGroupEnrollment)
      .set({ userId: owner.id, status: 'in_progress', updatedAt: now })
      .where(eq(credentialGroupEnrollment.id, enrollmentId))
  }
  await executor
    .update(credential)
    .set({
      organizationId: options.organizationId,
      workspaceId: null,
      credentialGroupEnrollmentId: enrollmentId,
      encryptedPersonalToken,
      updatedAt: now,
    })
    .where(and(eq(credential.id, current.id), eq(credential.workspaceId, current.workspaceId)))
  return true
}

/** Keyset-paged and resumable; every token and any new enrollment commit together. */
export async function migrateGitLabPersonalTokens(options: MigrationOptions, database = db) {
  if (!options.organizationId.trim()) throw new Error('An organization ID is required')
  await assertUniqueIdentities(database, options.organizationId)
  let afterId = ''
  let processed = 0
  while (true) {
    const candidates = await database
      .select({ id: credential.id })
      .from(credential)
      .innerJoin(workspace, eq(workspace.id, credential.workspaceId))
      .where(
        and(
          eq(credential.type, 'personal_token'),
          eq(workspace.organizationId, options.organizationId),
          gt(credential.id, afterId)
        )
      )
      .orderBy(asc(credential.id))
      .limit(BATCH_SIZE)
    if (!candidates.length) break
    for (const candidate of candidates) {
      const changed = await database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`)
        return migrateToken(tx, candidate.id, options)
      })
      if (changed) processed++
      afterId = candidate.id
    }
  }
  return { mode: options.apply ? 'applied' : 'dry-run', processed }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const organizationArgs = args.filter((arg) => arg.startsWith('--organization-id='))
  if (
    organizationArgs.length !== 1 ||
    args.some((arg) => arg !== '--apply' && !arg.startsWith('--organization-id='))
  ) {
    throw new Error('Usage: migrate-gitlab-personal-tokens.ts --organization-id=<id> [--apply]')
  }
  try {
    logger.info(
      'GitLab token migration complete',
      await migrateGitLabPersonalTokens({
        organizationId: organizationArgs[0]!.slice('--organization-id='.length),
        apply: args.includes('--apply'),
      })
    )
    process.exit(0)
  } catch (error) {
    logger.error('GitLab token migration failed', { error: getErrorMessage(error) })
    process.exit(1)
  }
}
