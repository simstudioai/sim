import { db } from '@sim/db'
import { credential, credentialMember } from '@sim/db/schema'
import { and, type Column, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { V2CredentialSortBy } from '@/lib/api/contracts/v2/credentials'
import type { ListSortOrder } from '@/lib/api/list-query'
import { listOrderBy, searchFilter } from '@/lib/api/list-query'
import { isSharedCredentialType, SHARED_CREDENTIAL_TYPES } from '@/lib/credentials/access'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Workspace-scoped credential reads shared by the session surface and the public
 * API, so the visibility rules cannot drift between them.
 */

export type CredentialRow = typeof credential.$inferSelect

export interface VisibleWorkspaceCredential {
  id: string
  workspaceId: string
  type: CredentialRow['type']
  displayName: string
  description: string | null
  providerId: string | null
  accountId: string | null
  envKey: string | null
  envOwnerUserId: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  hasServiceAccountKey: boolean
  role: 'admin' | 'member'
}

/**
 * The credentials a user may see in a workspace.
 *
 * Visibility is an explicit `credential_member` row, plus — for workspace
 * admins — every shared-type credential, plus the caller's own personal env
 * credentials. Encrypted secret material is never selected.
 */
/**
 * Orderings for the public list's sortable fields, made total over the contract
 * enum by `satisfies`. Each ends in `id` so credentials sharing a display name
 * or a timestamp still come back in a stable order.
 */
const CREDENTIAL_SORTS = {
  displayName: [credential.displayName, credential.id],
  createdAt: [credential.createdAt, credential.id],
  updatedAt: [credential.updatedAt, credential.id],
} satisfies Record<V2CredentialSortBy, readonly Column[]>

export async function listVisibleWorkspaceCredentials(params: {
  workspaceId: string
  userId: string
  workspaceAccess: Pick<WorkspaceAccess, 'canAdmin'>
  types?: CredentialRow['type'][]
  providerId?: string
  /** Case-insensitive substring match on the credential display name. */
  search?: string
  sortBy?: V2CredentialSortBy
  sortOrder?: ListSortOrder
}): Promise<VisibleWorkspaceCredential[]> {
  const {
    workspaceId,
    userId,
    workspaceAccess,
    types,
    providerId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = params

  const whereClauses = [eq(credential.workspaceId, workspaceId)]
  if (types?.length) whereClauses.push(inArray(credential.type, types))
  if (providerId) whereClauses.push(eq(credential.providerId, providerId))

  const isWorkspaceAdmin = workspaceAccess.canAdmin
  const accessClause = isWorkspaceAdmin
    ? or(
        isNotNull(credentialMember.id),
        inArray(credential.type, SHARED_CREDENTIAL_TYPES),
        eq(credential.envOwnerUserId, userId)
      )
    : or(isNotNull(credentialMember.id), eq(credential.envOwnerUserId, userId))

  const rows = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
      providerId: credential.providerId,
      accountId: credential.accountId,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
      memberRole: credentialMember.role,
    })
    .from(credential)
    .leftJoin(
      credentialMember,
      and(
        eq(credentialMember.credentialId, credential.id),
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active')
      )
    )
    .where(and(...whereClauses, accessClause, searchFilter(credential.displayName, search)))
    .orderBy(...listOrderBy(CREDENTIAL_SORTS[sortBy], sortOrder))

  return rows.map(({ memberRole, encryptedServiceAccountKey, ...rest }) => ({
    ...rest,
    hasServiceAccountKey: Boolean(encryptedServiceAccountKey),
    role:
      // An `env_personal` credential's own env owner administers it regardless of
      // workspace role — otherwise the owner of a personal secret can't manage it.
      (rest.type === 'env_personal' && rest.envOwnerUserId === userId) ||
      (isWorkspaceAdmin && isSharedCredentialType(rest.type))
        ? 'admin'
        : (memberRole ?? 'member'),
  }))
}

/**
 * Lists workspace-shared connection metadata for a workspace principal.
 *
 * Workspace API keys have no human identity and therefore never borrow their
 * creator's credential memberships. The public operation is limited to OAuth
 * and service-account connections, and this query does not select encrypted
 * credential material.
 */
export async function listWorkspacePrincipalCredentials(params: {
  workspaceId: string
  types: Array<'oauth' | 'service_account'>
  providerId?: string
  search?: string
  sortBy?: V2CredentialSortBy
  sortOrder?: ListSortOrder
}): Promise<VisibleWorkspaceCredential[]> {
  const {
    workspaceId,
    types,
    providerId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = params
  if (types.length === 0) throw new Error('Workspace credential types cannot be empty')

  const whereClauses = [eq(credential.workspaceId, workspaceId), inArray(credential.type, types)]
  if (providerId) whereClauses.push(eq(credential.providerId, providerId))

  const rows = await db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
      providerId: credential.providerId,
      accountId: credential.accountId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      hasServiceAccountKey: sql<boolean>`${credential.encryptedServiceAccountKey} IS NOT NULL`,
    })
    .from(credential)
    .where(and(...whereClauses, searchFilter(credential.displayName, search)))
    .orderBy(...listOrderBy(CREDENTIAL_SORTS[sortBy], sortOrder))

  return rows.map((row) => ({
    ...row,
    envKey: null,
    envOwnerUserId: null,
    role: 'member',
  }))
}

/**
 * A single credential scoped to a workspace, or null when it does not exist
 * there. Scoping by workspace is what keeps a credential id from another tenant
 * from resolving at all.
 */
export async function getWorkspaceCredential(params: {
  workspaceId: string
  credentialId: string
}): Promise<CredentialRow | null> {
  const [row] = await db
    .select()
    .from(credential)
    .where(
      and(eq(credential.id, params.credentialId), eq(credential.workspaceId, params.workspaceId))
    )
    .limit(1)
  return row ?? null
}
