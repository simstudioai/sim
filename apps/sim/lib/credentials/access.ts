import { db } from '@sim/db'
import { account, credential, credentialMember, credentialTypeEnum, member } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  type ResourceScope,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import type { DbOrTx } from '@/lib/db/types'
import {
  getUserEntityPermissions,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

type ActiveCredentialMember = typeof credentialMember.$inferSelect
type CredentialRecord = typeof credential.$inferSelect

export type CredentialType = (typeof credentialTypeEnum.enumValues)[number]
export type ManagedCredentialType = Extract<CredentialType, 'managed_oauth' | 'managed_mcp'>

export const MANAGED_CREDENTIAL_TYPES: readonly ManagedCredentialType[] = [
  'managed_oauth',
  'managed_mcp',
]

export function isManagedCredentialType(type: CredentialType): type is ManagedCredentialType {
  return MANAGED_CREDENTIAL_TYPES.some((managed) => managed === type)
}

export type OrdinaryCredentialType = Exclude<CredentialType, ManagedCredentialType>

/** Narrows credentials exposed through ordinary user-managed credential surfaces. */
export function requireOrdinaryCredentialType(type: CredentialType): OrdinaryCredentialType {
  if (isManagedCredentialType(type)) {
    throw new Error('Managed credential reached an ordinary credential surface')
  }
  return type
}

/**
 * Credential types shared at the workspace level — every type except personal
 * credentials. Derived from the enum so a newly added credential type is
 * treated as shared by default, keeping visibility, role, and admin derivation
 * consistent instead of drifting against a hand-maintained inclusion list.
 */
export const SHARED_CREDENTIAL_TYPES = credentialTypeEnum.enumValues.filter(
  (type) => type !== 'env_personal' && type !== 'personal_token'
)

/**
 * Which user a credential's token must be read as.
 *
 * Service-account credentials mint their own token and ignore the acting user
 * entirely, so they carry no user id — callers pass their existing one through.
 */
export type CredentialTokenIdentity =
  | { kind: 'service_account' }
  | { kind: 'oauth'; userId: string }

/**
 * Resolves which user a credential's token must be read as, for background jobs
 * that run without a request context (connector syncs, scheduled runs).
 *
 * Workspace-scoped OAuth credentials are shared, so the member who authorized one
 * is frequently not the user driving the job. Token reads are scoped to
 * `account.userId`, so a job passing its own user id resolves no token at all.
 * Mirrors the ownership resolution in `authorizeCredentialUse`: the credential must
 * belong to `workspaceId`, and its owner must still have access to that workspace.
 *
 * @returns the identity to read the token as, or `null` when the credential is
 * unusable from this workspace (wrong workspace, missing account, owner lost access).
 */
export async function resolveCredentialTokenIdentity(
  credentialId: string,
  owner: string | ResourceScope
): Promise<CredentialTokenIdentity | null> {
  const scope: ResourceScope =
    typeof owner === 'string' ? { kind: 'workspace', workspaceId: owner } : owner
  const [platformCredential] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      createdBy: credential.createdBy,
      type: credential.type,
      accountId: credential.accountId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (platformCredential) {
    if (!sameResourceScope(resourceScopeFromOwner(platformCredential), scope)) return null
    if (platformCredential.type === 'service_account') {
      if (scope.kind === 'organization') {
        if (!platformCredential.createdBy) return null
        const [membership] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, scope.organizationId),
              eq(member.userId, platformCredential.createdBy)
            )
          )
          .limit(1)
        if (!membership) return null
      }
      return { kind: 'service_account' }
    }
    if (platformCredential.type !== 'oauth' || !platformCredential.accountId) return null
  }

  if (!platformCredential && scope.kind === 'organization') return null

  // Credentials predating the workspace-scoped `credential` table are raw account ids.
  const accountId = platformCredential?.accountId ?? credentialId

  const [accountRow] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)

  if (!accountRow) return null

  if (scope.kind === 'organization') {
    if (platformCredential?.createdBy !== accountRow.userId) return null
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.organizationId, scope.organizationId), eq(member.userId, accountRow.userId))
      )
      .limit(1)
    if (!membership) return null
  } else {
    const ownerPerm = await getUserEntityPermissions(
      accountRow.userId,
      'workspace',
      scope.workspaceId
    )
    if (ownerPerm === null) return null
  }

  return { kind: 'oauth', userId: accountRow.userId }
}

/** Whether a credential is shared at the workspace level (excluding personal credentials). */
export function isSharedCredentialType(type: CredentialType): boolean {
  return type !== 'env_personal' && type !== 'personal_token'
}

/**
 * Whether a user is an admin of a credential: an explicit credential-member admin,
 * or — for shared credentials only — a workspace admin (workspace admins are
 * derived credential admins, but never for personal credentials).
 */
export function deriveCredentialAdmin(params: {
  credentialType: CredentialType
  memberRole: ActiveCredentialMember['role'] | null | undefined
  workspaceCanAdmin: boolean
}): boolean {
  return (
    params.memberRole === 'admin' ||
    (isSharedCredentialType(params.credentialType) && params.workspaceCanAdmin)
  )
}

export interface CredentialActorContext {
  credential: CredentialRecord | null
  member: ActiveCredentialMember | null
  hasWorkspaceAccess: boolean
  canWriteWorkspace: boolean
  isAdmin: boolean
}

/**
 * Whether a user may *use* a credential: they still have access to its workspace
 * and are either an active member or a derived credential admin.
 *
 * Deliberately distinct from the admin-only rule that governs *managing* a
 * credential (rename, delete, membership changes) — that one has no member
 * fallback. Do not fold the two together.
 */
export function canUseCredential(access: CredentialActorContext): boolean {
  return access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin)
}

/**
 * Resolves user access context for a credential. Pass `workspaceAccess` when the
 * caller has already resolved access for the credential's workspace to skip a
 * redundant lookup; it is reused only when it matches the credential's workspace.
 */
export async function getCredentialActorContext(
  credentialId: string,
  userId: string,
  options?: { workspaceAccess?: WorkspaceAccess }
): Promise<CredentialActorContext> {
  const [credentialRow] = await db
    .select()
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!credentialRow?.workspaceId) {
    return {
      credential: null,
      member: null,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: false,
    }
  }

  const workspaceAccess = await resolveWorkspaceAccess(
    credentialRow.workspaceId,
    userId,
    options?.workspaceAccess
  )
  if (credentialRow.type === 'personal_token') {
    return {
      credential: credentialRow.createdBy === userId ? credentialRow : null,
      member: null,
      hasWorkspaceAccess: workspaceAccess.hasAccess,
      canWriteWorkspace: workspaceAccess.canWrite,
      isAdmin: credentialRow.createdBy === userId && workspaceAccess.hasAccess,
    }
  }
  const [memberRow] = await db
    .select()
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.credentialId, credentialId),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
    .limit(1)

  const isAdmin = deriveCredentialAdmin({
    credentialType: credentialRow.type,
    memberRole: memberRow?.role,
    workspaceCanAdmin: workspaceAccess.canAdmin,
  })

  return {
    credential: credentialRow,
    member: memberRow ?? null,
    hasWorkspaceAccess: workspaceAccess.hasAccess,
    canWriteWorkspace: workspaceAccess.canWrite,
    isAdmin,
  }
}

/**
 * Revokes all credential memberships for a user across one or more workspaces.
 * Workspace owners and admins are derived credential admins, so no per-credential
 * owner promotion is needed to avoid orphaning a credential. Returns the number
 * of memberships revoked.
 *
 * Deliberately DIVERGES from the skill sibling (`removeWorkspaceSkillMembershipsTx`
 * deletes active rows): credential access is explicit-rows-only, so a revoked
 * row here is an inert tombstone the env-credential join sync uses to avoid
 * resurrecting access. Skills have an implicit workspace-shared grant, where a
 * revoked row is a live per-skill DENY marker and a kept-active row would
 * re-grant on rejoin — do not "harmonize" either helper toward the other.
 */
export async function revokeWorkspaceCredentialMembershipsTx(
  tx: DbOrTx,
  workspaceId: string | string[],
  userId: string
): Promise<number> {
  const workspaceIds = Array.isArray(workspaceId) ? workspaceId : [workspaceId]
  if (workspaceIds.length === 0) return 0

  const workspaceCredentialIds = await tx
    .select({ id: credential.id })
    .from(credential)
    .where(inArray(credential.workspaceId, workspaceIds))

  if (workspaceCredentialIds.length === 0) return 0

  const credIds = workspaceCredentialIds.map((c) => c.id)

  const revoked = await tx
    .update(credentialMember)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active'),
        inArray(credentialMember.credentialId, credIds)
      )
    )
    .returning({ id: credentialMember.id })

  return revoked.length
}
