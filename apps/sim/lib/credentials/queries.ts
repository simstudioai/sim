import { db } from '@sim/db'
import { credential, credentialMember, member, workspace } from '@sim/db/schema'
import { and, eq, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm'
import type { V2CredentialSortBy } from '@/lib/api/contracts/v2/credentials'
import {
  type CursorKey,
  type KeysetKey,
  type KeysetPage,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import {
  isSharedCredentialType,
  type OrdinaryCredentialType,
  requireOrdinaryCredentialType,
  SHARED_CREDENTIAL_TYPES,
} from '@/lib/credentials/access'
import type { WorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Workspace-scoped credential reads shared by the session surface and the public
 * API, so the visibility rules cannot drift between them.
 */

export type CredentialRow = typeof credential.$inferSelect

export interface VisibleWorkspaceCredential {
  id: string
  workspaceId: string | null
  organizationId?: string | null
  type: CredentialRow['type']
  displayName: string
  description: string | null
  /** True only on env_workspace secrets that opt out of redaction. */
  unredacted: boolean
  providerId: string | null
  accountId: string | null
  envKey: string | null
  envOwnerUserId: string | null
  providerTenantId?: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  hasServiceAccountKey: boolean
  role: 'admin' | 'member'
}

export interface WorkspaceCredentialLookup {
  id: string
  displayName: string
  type: OrdinaryCredentialType
  providerId: string | null
}

const credentialIdKey = textKey<VisibleWorkspaceCredential>(credential.id, (row) => row.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`. Each ends in `id` so credentials sharing a
 * display name or a timestamp still come back in a stable order — which is also
 * what makes the cursor resumable, since a non-unique final key can repeat or
 * skip a row at a page boundary.
 *
 * The keys encode from {@link VisibleWorkspaceCredential} — the mapped row, not
 * the raw select — because both readers below derive their projection before
 * the page is cut, so the cursor is always stamped from the row the caller
 * actually received.
 */
const CREDENTIAL_SORTS = {
  displayName: [
    textKey<VisibleWorkspaceCredential>(credential.displayName, (row) => row.displayName),
    credentialIdKey,
  ],
  createdAt: [
    timestampKey<VisibleWorkspaceCredential>(credential.createdAt, (row) => row.createdAt),
    credentialIdKey,
  ],
  updatedAt: [
    timestampKey<VisibleWorkspaceCredential>(credential.updatedAt, (row) => row.updatedAt),
    credentialIdKey,
  ],
} satisfies Record<V2CredentialSortBy, readonly KeysetKey<VisibleWorkspaceCredential>[]>

/** One page of workspace credentials plus the keys that resume it. */
export type WorkspaceCredentialPage = KeysetPage<VisibleWorkspaceCredential>

/** Personal organization tokens are visible only to their owner in the same organization. */
function visibleCredentialScope(workspaceId: string, userId?: string) {
  return or(
    eq(credential.workspaceId, workspaceId),
    userId
      ? and(
          eq(credential.type, 'personal_token'),
          eq(credential.createdBy, userId),
          sql`exists (select 1 from ${workspace} inner join ${member} on ${member.organizationId} = ${workspace.organizationId}
        where ${workspace.id} = ${workspaceId} and ${workspace.organizationId} = ${credential.organizationId}
        and ${member.userId} = ${userId} and ${workspace.archivedAt} is null)`
        )
      : undefined
  )
}

/**
 * The credentials a user may see in a workspace.
 *
 * Visibility is an explicit `credential_member` row, plus — for workspace
 * admins — every shared-type credential, plus the caller's own personal env
 * credentials. Encrypted secret material is never selected.
 */
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
  /** Page size. Omitted by the unpaged session surface — see {@link keysetPage}. */
  limit?: number
  cursorKeys?: CursorKey[]
  /**
   * Restricts personal env credentials to the caller's own, in SQL.
   *
   * The secrets surface used to apply this as a JS filter over the query's
   * result. That is invisible on an unpaged read but a correctness bug once the
   * query is paged: a page of `limit` rows trimmed afterwards hands the caller
   * fewer rows than it asked for while `nextCursor` still claims more. It is a
   * pure page-size fix — the predicate drops exactly the rows the JS filter
   * dropped (another user's `env_personal` row, reachable only via an explicit
   * `credential_member` grant), and never widens what a caller can see.
   */
  ownedEnvSecretsOnly?: boolean
}): Promise<WorkspaceCredentialPage> {
  const {
    workspaceId,
    userId,
    workspaceAccess,
    types,
    providerId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    limit,
  } = params

  const whereClauses = [
    visibleCredentialScope(workspaceId, userId),
    notInArray(credential.type, ['managed_oauth', 'managed_mcp']),
    isNotNull(credential.createdBy),
    or(sql`${credential.type} <> 'personal_token'`, eq(credential.createdBy, userId)),
  ]
  if (types?.length) whereClauses.push(inArray(credential.type, types))
  if (providerId) whereClauses.push(eq(credential.providerId, providerId))
  const ownedEnvSecretsClause = params.ownedEnvSecretsOnly
    ? or(
        eq(credential.type, 'env_workspace'),
        and(eq(credential.type, 'env_personal'), eq(credential.envOwnerUserId, userId))
      )
    : undefined

  const keys = CREDENTIAL_SORTS[sortBy]
  const after = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const isWorkspaceAdmin = workspaceAccess.canAdmin
  const accessClause = isWorkspaceAdmin
    ? or(
        isNotNull(credentialMember.id),
        inArray(credential.type, SHARED_CREDENTIAL_TYPES),
        eq(credential.envOwnerUserId, userId),
        and(eq(credential.type, 'personal_token'), eq(credential.createdBy, userId))
      )
    : or(
        isNotNull(credentialMember.id),
        eq(credential.envOwnerUserId, userId),
        and(eq(credential.type, 'personal_token'), eq(credential.createdBy, userId))
      )

  const query = db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
      unredacted: credential.unredacted,
      providerId: credential.providerId,
      accountId: credential.accountId,
      envKey: credential.envKey,
      envOwnerUserId: credential.envOwnerUserId,
      providerTenantId: credential.providerTenantId,
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
    .where(
      and(
        ...whereClauses,
        accessClause,
        ownedEnvSecretsClause,
        searchFilter(credential.displayName, search),
        after
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))

  const rows = await (limit === undefined ? query : query.limit(limit + 1))

  const mapped = rows.map(({ memberRole, encryptedServiceAccountKey, ...rest }) => {
    if (!rest.workspaceId && !(rest.type === 'personal_token' && rest.organizationId))
      throw new Error('Workspace credential query returned an unscoped credential')
    if (!rest.createdBy) throw new Error(`Credential ${rest.id} has no creator`)
    return {
      ...rest,
      workspaceId: rest.workspaceId,
      createdBy: rest.createdBy,
      hasServiceAccountKey: Boolean(encryptedServiceAccountKey),
      /**
       * An `env_personal` credential's own env owner administers it regardless of
       * workspace role — otherwise the owner of a personal secret can't manage it.
       */
      role:
        (rest.type === 'env_personal' && rest.envOwnerUserId === userId) ||
        (rest.type === 'personal_token' && rest.createdBy === userId) ||
        (isWorkspaceAdmin && isSharedCredentialType(rest.type))
          ? ('admin' as const)
          : (memberRole ?? ('member' as const)),
    }
  })

  return keysetPage(keys, mapped, limit)
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
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<WorkspaceCredentialPage> {
  const {
    workspaceId,
    types,
    providerId,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    limit,
  } = params
  if (types.length === 0) throw new Error('Workspace credential types cannot be empty')

  const whereClauses = [eq(credential.workspaceId, workspaceId), inArray(credential.type, types)]
  if (providerId) whereClauses.push(eq(credential.providerId, providerId))

  const keys = CREDENTIAL_SORTS[sortBy]
  const after = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const query = db
    .select({
      id: credential.id,
      workspaceId: credential.workspaceId,
      type: credential.type,
      displayName: credential.displayName,
      description: credential.description,
      unredacted: credential.unredacted,
      providerId: credential.providerId,
      accountId: credential.accountId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      hasServiceAccountKey: sql<boolean>`${credential.encryptedServiceAccountKey} IS NOT NULL`,
    })
    .from(credential)
    .where(and(...whereClauses, searchFilter(credential.displayName, search), after))
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))

  const rows = await query.limit(limit + 1)

  const mapped = rows.map((row) => {
    if (!row.workspaceId)
      throw new Error('Workspace credential query returned an unscoped credential')
    if (!row.createdBy) throw new Error(`Credential ${row.id} has no creator`)
    return {
      ...row,
      workspaceId: row.workspaceId,
      createdBy: row.createdBy,
      envKey: null,
      envOwnerUserId: null,
      role: 'member' as const,
    }
  })

  return keysetPage(keys, mapped, limit)
}
/**
 * A single credential scoped to a workspace, or null when it does not exist
 * there. Scoping by workspace is what keeps a credential id from another tenant
 * from resolving at all.
 */
export async function getWorkspaceCredential(params: {
  workspaceId: string
  credentialId: string
  organizationId?: string
}): Promise<CredentialRow | null> {
  const [row] = await db
    .select()
    .from(credential)
    .where(
      and(
        eq(credential.id, params.credentialId),
        or(
          eq(credential.workspaceId, params.workspaceId),
          params.organizationId
            ? and(
                eq(credential.type, 'personal_token'),
                eq(credential.organizationId, params.organizationId)
              )
            : undefined
        ),
        notInArray(credential.type, ['managed_oauth', 'managed_mcp'])
      )
    )
    .limit(1)
  return row ?? null
}

/** Preserves the internal route's legacy id-first, account-id-second lookup semantics. */
export async function findWorkspaceCredentialLookup(params: {
  workspaceId: string
  credentialId: string
  userId?: string
}): Promise<WorkspaceCredentialLookup | null> {
  const projection = {
    id: credential.id,
    displayName: credential.displayName,
    type: credential.type,
    providerId: credential.providerId,
  }
  const [byId] = await db
    .select(projection)
    .from(credential)
    .where(
      and(
        eq(credential.id, params.credentialId),
        visibleCredentialScope(params.workspaceId, params.userId),
        notInArray(credential.type, ['managed_oauth', 'managed_mcp']),
        params.userId
          ? or(sql`${credential.type} <> 'personal_token'`, eq(credential.createdBy, params.userId))
          : sql`${credential.type} <> 'personal_token'`
      )
    )
    .limit(1)
  if (byId) return { ...byId, type: requireOrdinaryCredentialType(byId.type) }

  const [byAccountId] = await db
    .select(projection)
    .from(credential)
    .where(
      and(
        eq(credential.accountId, params.credentialId),
        eq(credential.workspaceId, params.workspaceId),
        notInArray(credential.type, ['managed_oauth', 'managed_mcp']),
        params.userId
          ? or(sql`${credential.type} <> 'personal_token'`, eq(credential.createdBy, params.userId))
          : sql`${credential.type} <> 'personal_token'`
      )
    )
    .limit(1)
  return byAccountId
    ? { ...byAccountId, type: requireOrdinaryCredentialType(byAccountId.type) }
    : null
}

/** Canonical credential lookup used before its workspace scope is known. */
export async function getCredentialById(credentialId: string): Promise<CredentialRow | null> {
  const [row] = await db
    .select()
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        notInArray(credential.type, ['managed_oauth', 'managed_mcp'])
      )
    )
    .limit(1)
  return row ?? null
}
