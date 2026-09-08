import type { PrincipalSubject } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  user,
} from '@sim/db/schema'
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import {
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type { CredentialGroupEnrollmentStatus } from '@/lib/credential-groups/types'

export const MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE = 100

export type ManagedOAuthCredentialStatus = 'active' | 'needs_reauth' | 'revoked'

export interface CredentialGroupCredentialListContext {
  credentialGroupId: string
  workspaceId: string
  name: string
  status: 'active' | 'disabled'
  options: CredentialGroupOptionConfig[]
}

export interface CredentialGroupCredentialReference {
  credentialId: string
  email: string
  displayName: string
  providerId: string
  providerSubjectId: string
  providerTenantId: string | null
}

/**
 * A credential collected under one option, in any state. Carries both statuses
 * so a caller reconciling membership can tell a live credential from one that
 * needs re-authorisation or whose enrollment was revoked.
 */
export interface CredentialGroupOptionCredentialReference
  extends CredentialGroupCredentialReference {
  managedOauthStatus: ManagedOAuthCredentialStatus
  enrollmentStatus: CredentialGroupEnrollmentStatus
}

/** Where a managed credential sits: its group and the option it was collected under. */
export interface ManagedCredentialGroupBinding {
  credentialId: string
  workspaceId: string | null
  organizationId?: string | null
  providerId: string
  credentialGroupId: string
  credentialGroupOptionId: string
  managedOauthStatus: ManagedOAuthCredentialStatus
  enrollmentStatus: CredentialGroupEnrollmentStatus
  groupStatus: 'active' | 'disabled'
  /** Null when the option was removed from the group. */
  optionStatus: 'active' | 'disabled' | null
}

/** Enrollment statuses under which a person's managed credentials count as theirs. */
export const LIVE_ENROLLMENT_STATUSES = ['in_progress', 'completed'] as const

/**
 * Whether a managed credential may be used right now: the credential, its
 * enrollment, its option, and its group are all live. Every consumer that
 * mints a token from a binding checks this, so a disabled option or a revoked
 * enrollment denies without waiting for a scope bump to invalidate the
 * credential itself.
 */
export function isManagedCredentialGroupBindingLive(
  binding: Pick<
    ManagedCredentialGroupBinding,
    'managedOauthStatus' | 'enrollmentStatus' | 'groupStatus' | 'optionStatus'
  >
): boolean {
  return (
    binding.managedOauthStatus === 'active' &&
    (LIVE_ENROLLMENT_STATUSES as readonly string[]).includes(binding.enrollmentStatus) &&
    binding.groupStatus === 'active' &&
    binding.optionStatus === 'active'
  )
}

export interface CredentialGroupEnrollmentAccess {
  enrollmentId: string
  email: string
}

export class CredentialGroupCredentialCursorNotFoundError extends Error {
  constructor() {
    super('Credential group credential cursor not found')
    this.name = 'CredentialGroupCredentialCursorNotFoundError'
  }
}

interface ListCredentialGroupCredentialReferencesInput {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  limit: number
  cursor?: string
  email?: string
  credentialProviderIds?: string[]
  credentialGroupOptionIds: string[]
}

interface ListCredentialGroupOptionCredentialReferencesInput {
  workspaceId?: string
  organizationId?: string
  credentialGroupId: string
  credentialGroupOptionId: string
  limit: number
  cursor?: string
}

/** Resolves a verified Sim user's active enrollment in one Credential Group. */
export async function loadCredentialGroupEnrollmentAccess(
  credentialGroupId: string,
  userId: string
): Promise<CredentialGroupEnrollmentAccess | null> {
  const [row] = await db
    .select({
      enrollmentId: credentialGroupEnrollment.id,
      email: credentialGroupEnrollment.email,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .where(
      and(
        eq(user.id, userId),
        eq(user.emailVerified, true),
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES])
      )
    )
    .limit(1)
  return row ?? null
}

/** Resolves a verified Sim or provider subject to exactly one active enrollment. */
export async function loadCredentialGroupEnrollmentAccessForSubject(
  credentialGroupId: string,
  subject: PrincipalSubject
): Promise<CredentialGroupEnrollmentAccess | null> {
  if (subject.kind === 'sim_user') {
    return loadCredentialGroupEnrollmentAccess(credentialGroupId, subject.userId)
  }
  if (subject.kind !== 'external_user') return null
  if (!isCredentialGroupProvider(subject.provider)) return null
  const providerId = getCredentialGroupProviderId(subject.provider)
  const rows = await db
    .selectDistinct({
      enrollmentId: credentialGroupEnrollment.id,
      email: credentialGroupEnrollment.email,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credential, eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id))
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        eq(credential.type, 'managed_oauth'),
        eq(credential.managedOauthStatus, 'active'),
        eq(credential.providerId, providerId),
        eq(credential.providerTenantId, subject.tenantId),
        eq(credential.providerSubjectId, subject.subjectId)
      )
    )
    .limit(2)
  if (rows.length > 1) {
    throw new Error('External subject resolves to multiple Credential Group enrollments')
  }
  return rows[0] ?? null
}

/** Loads the canonical group ownership needed by the application authorization boundary. */
export async function loadCredentialGroupCredentialListContext(
  credentialGroupId: string
): Promise<CredentialGroupCredentialListContext | null> {
  return loadCredentialGroupContext(eq(credentialGroup.id, credentialGroupId))
}

/** Loads the workspace's single accounts container without decrypting provider settings. */
export async function loadWorkspaceAccountsCredentialListContext(
  workspaceId: string
): Promise<CredentialGroupCredentialListContext | null> {
  return loadCredentialGroupContext(eq(credentialGroup.workspaceId, workspaceId))
}

async function loadCredentialGroupContext(
  scope: SQL
): Promise<CredentialGroupCredentialListContext | null> {
  const [row] = await db
    .select({
      credentialGroupId: credentialGroup.id,
      workspaceId: credentialGroup.workspaceId,
      name: credentialGroup.name,
      status: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .where(scope)
    .limit(1)
  return row?.workspaceId ? { ...row, workspaceId: row.workspaceId } : null
}

/** Loads where a managed credential sits without selecting token material. */
export async function loadManagedCredentialGroupBinding(
  credentialId: string
): Promise<ManagedCredentialGroupBinding | null> {
  const [row] = await db
    .select({
      credentialId: credential.id,
      createdBy: credential.createdBy,
      enrollmentUserId: credentialGroupEnrollment.userId,
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      providerId: credential.providerId,
      credentialGroupId: credentialGroupEnrollment.credentialGroupId,
      credentialGroupOptionId: credential.credentialGroupOptionId,
      managedOauthStatus: credential.managedOauthStatus,
      enrollmentStatus: credentialGroupEnrollment.status,
      groupStatus: credentialGroup.status,
      groupOptions: credentialGroup.options,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.type, 'managed_oauth'),
        or(
          and(
            eq(credential.workspaceId, credentialGroup.workspaceId),
            isNull(credential.organizationId),
            isNull(credentialGroup.organizationId)
          ),
          and(
            eq(credential.organizationId, credentialGroup.organizationId),
            isNull(credential.workspaceId),
            isNull(credentialGroup.workspaceId)
          )
        )
      )
    )
    .limit(1)
  if (!row) return null
  if (row.organizationId) {
    if (!row.enrollmentUserId || row.enrollmentUserId !== row.createdBy) {
      throw new Error('Organization credential is not bound to its enrolled user')
    }
  }
  if (!row.providerId) throw new Error(`Managed credential ${row.credentialId} has no provider ID`)
  if (!row.credentialGroupOptionId) {
    throw new Error(`Managed credential ${row.credentialId} has no credential option`)
  }
  if (!row.managedOauthStatus) {
    throw new Error(`Managed credential ${row.credentialId} has no managed OAuth status`)
  }
  return {
    credentialId: row.credentialId,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    providerId: row.providerId,
    credentialGroupId: row.credentialGroupId,
    credentialGroupOptionId: row.credentialGroupOptionId,
    managedOauthStatus: row.managedOauthStatus,
    enrollmentStatus: row.enrollmentStatus,
    groupStatus: row.groupStatus,
    optionStatus:
      row.groupOptions.find((option) => option.id === row.credentialGroupOptionId)?.status ?? null,
  }
}

interface CredentialReferencePageRow {
  id: string
  email: string
  displayName: string
  providerId: string | null
  providerSubjectId: string | null
  providerTenantId: string | null
  managedOauthStatus: ManagedOAuthCredentialStatus | null
  enrollmentStatus: CredentialGroupEnrollmentStatus
  createdAt: Date
}

/**
 * One keyset page of managed credentials joined to their enrollment. The cursor
 * is re-validated against the same conditions as the page, so a cursor that no
 * longer satisfies the listing (the credential left the set) is refused rather
 * than silently repositioned.
 */
async function pageCredentialReferences(
  conditions: readonly (SQL | undefined)[],
  limit: number,
  cursor: string | undefined
): Promise<{ rows: CredentialReferencePageRow[]; nextCursor: string | null }> {
  let cursorPosition: { id: string } | undefined
  if (cursor) {
    const [cursorRow] = await db
      .select({ id: credential.id })
      .from(credential)
      .innerJoin(
        credentialGroupEnrollment,
        eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
      )
      .where(and(eq(credential.id, cursor), ...conditions))
      .limit(1)
    if (!cursorRow) throw new CredentialGroupCredentialCursorNotFoundError()
    cursorPosition = cursorRow
  }

  /** Compare timestamps inside PostgreSQL so JavaScript Date rounding cannot repeat a page. */
  const rows = await db
    .select({
      id: credential.id,
      email: credentialGroupEnrollment.email,
      displayName: credential.displayName,
      providerId: credential.providerId,
      providerSubjectId: credential.providerSubjectId,
      providerTenantId: credential.providerTenantId,
      managedOauthStatus: credential.managedOauthStatus,
      enrollmentStatus: credentialGroupEnrollment.status,
      createdAt: credential.createdAt,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .where(
      and(
        ...conditions,
        cursorPosition
          ? or(
              gt(
                credential.createdAt,
                sql`(SELECT created_at FROM credential WHERE id = ${cursorPosition.id})`
              ),
              and(
                eq(
                  credential.createdAt,
                  sql`(SELECT created_at FROM credential WHERE id = ${cursorPosition.id})`
                ),
                gt(credential.id, cursorPosition.id)
              )
            )
          : undefined
      )
    )
    .orderBy(asc(credential.createdAt), asc(credential.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? pageRows.at(-1)?.id : null
  if (hasMore && !nextCursor) throw new Error('Credential page cursor could not be derived')
  return { rows: pageRows, nextCursor: nextCursor ?? null }
}

function toCredentialReference(
  row: CredentialReferencePageRow
): CredentialGroupCredentialReference {
  if (!row.providerId) throw new Error(`Managed credential ${row.id} has no provider ID`)
  if (!row.providerSubjectId) {
    throw new Error(`Managed credential ${row.id} has no provider subject ID`)
  }
  return {
    credentialId: row.id,
    email: row.email,
    displayName: row.displayName,
    providerId: row.providerId,
    providerSubjectId: row.providerSubjectId,
    providerTenantId: row.providerTenantId,
  }
}

/** Lists one bounded page of active managed credentials without selecting token material. */
export async function listCredentialGroupCredentialReferences({
  workspaceId,
  organizationId,
  credentialGroupId,
  limit,
  cursor,
  email,
  credentialProviderIds,
  credentialGroupOptionIds,
}: ListCredentialGroupCredentialReferencesInput): Promise<{
  credentials: CredentialGroupCredentialReference[]
  nextCursor: string | null
}> {
  if (credentialGroupOptionIds.length === 0) {
    if (cursor) throw new CredentialGroupCredentialCursorNotFoundError()
    return { credentials: [], nextCursor: null }
  }

  const page = await pageCredentialReferences(
    [
      resourceScopeCondition(credential, resourceScopeFromOwner({ workspaceId, organizationId })),
      eq(credential.type, 'managed_oauth'),
      eq(credential.managedOauthStatus, 'active'),
      eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
      organizationId
        ? and(
            isNotNull(credentialGroupEnrollment.userId),
            eq(credential.createdBy, credentialGroupEnrollment.userId)
          )
        : undefined,
      email ? eq(credentialGroupEnrollment.email, email) : undefined,
      inArray(credential.credentialGroupOptionId, credentialGroupOptionIds),
      credentialProviderIds?.length
        ? inArray(credential.providerId, credentialProviderIds)
        : undefined,
      inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
    ],
    limit,
    cursor
  )
  return { credentials: page.rows.map(toCredentialReference), nextCursor: page.nextCursor }
}

/**
 * Lists one bounded page of every managed credential collected under one
 * option, whatever its status. This is the reconciliation view: a caller that
 * mirrors membership needs to see a credential that stopped being usable, not
 * just the ones that still are.
 */
export async function listCredentialGroupOptionCredentialReferences({
  workspaceId,
  organizationId,
  credentialGroupId,
  credentialGroupOptionId,
  limit,
  cursor,
}: ListCredentialGroupOptionCredentialReferencesInput): Promise<{
  credentials: CredentialGroupOptionCredentialReference[]
  nextCursor: string | null
}> {
  const page = await pageCredentialReferences(
    [
      resourceScopeCondition(credential, resourceScopeFromOwner({ workspaceId, organizationId })),
      eq(credential.type, 'managed_oauth'),
      eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
      eq(credential.credentialGroupOptionId, credentialGroupOptionId),
    ],
    limit,
    cursor
  )
  return {
    credentials: page.rows.map((row) => {
      if (!row.managedOauthStatus) {
        throw new Error(`Managed credential ${row.id} has no managed OAuth status`)
      }
      return {
        ...toCredentialReference(row),
        managedOauthStatus: row.managedOauthStatus,
        enrollmentStatus: row.enrollmentStatus,
      }
    }),
    nextCursor: page.nextCursor,
  }
}

/** Resolves an account container using its explicit ownership, without token material. */
export async function loadScopedAccountsCredentialListContext(
  scope: ResourceScope,
  credentialGroupId?: string
) {
  const [row] = await db
    .select({
      credentialGroupId: credentialGroup.id,
      workspaceId: credentialGroup.workspaceId,
      organizationId: credentialGroup.organizationId,
      name: credentialGroup.name,
      status: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .where(
      and(
        resourceScopeCondition(credentialGroup, scope),
        credentialGroupId ? eq(credentialGroup.id, credentialGroupId) : undefined
      )
    )
    .limit(1)
  return row ?? null
}
