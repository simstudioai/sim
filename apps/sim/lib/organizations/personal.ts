import { db } from '@sim/db'
import {
  assistantToolPermission,
  copilotChats,
  copilotOrganizationRequestStops,
  copilotRuns,
  credential,
  invitation,
  knowledgeBase,
  knowledgeConnectorMember,
  knowledgeExternalDirectory,
  knowledgeExternalGroup,
  mcpServerOauth,
  mcpServers,
  member,
  mothershipBenchmarks,
  mothershipMemorySelections,
  mothershipMemorySpaces,
  organization,
  organizationAccessRequestSettings,
  organizationSearchHistory,
  organizationSearchMcpInvocation,
  pendingCredentialDraft,
  permissionAccessRequest,
  simLink,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, getTableName, inArray, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/identity-lock'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { enqueuePersonalOrganizationAuditTx } from '@/lib/organizations/lifecycle-audit'
import { enqueueOrganizationStoredObjectCleanup } from '@/lib/organizations/resource-cleanup'
import { transferWorkspaceProjects } from '@/lib/projects/membership'

const logger = createLogger('PersonalOrganization')

/** The user's personal organization, or null when they have none (or belong to a team). */
export async function getPersonalOrganizationId(
  userId: string,
  executor: DbOrTx = db
): Promise<string | null> {
  const [row] = await executor
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.kind, 'personal')))
    .limit(1)
  return row?.organizationId ?? null
}

/**
 * Row-locks a personal organization for the rest of the transaction. Every insert of a row that
 * references it holds `FOR KEY SHARE` on it until commit, so this waits out writes already in
 * flight (whose rows the caller then sees and moves) and parks new ones until the caller commits.
 * Without it, a chat or run committed between moving content and deleting the organization would
 * be cascade-deleted with it.
 */
async function lockPersonalOrganizationTx(tx: DbTransaction, organizationId: string) {
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for('update')
}

/** A stable, valid, collision-free slug: users are unique, and so is their personal organization. */
function personalOrganizationSlug(userId: string): string {
  return `personal-${userId.toLowerCase().replace(/[^a-z0-9-_]+/g, '-')}`
}

function personalOrganizationName(row: { name: string | null; email: string }): string {
  return row.name?.trim() || row.email.split('@')[0] || 'Personal'
}

/**
 * Creates the personal organization of a user who belongs to no organization, with them as owner.
 * Returns null, writing nothing, when they already belong to one, no longer exist, or the
 * `personal-organizations` flag is off: until every process runs the release that bills a personal
 * organization to its owner, nothing creates one (signup, the product shell, leaving a team, the
 * backfill), and those accounts stay organization-less as before. Takes the user's
 * billing-identity lock, the fence every membership change holds.
 */
export async function createPersonalOrganizationTx(
  tx: DbTransaction,
  userId: string,
  organizationId = `org_${generateId()}`
): Promise<string | null> {
  if (!(await isFeatureEnabled('personal-organizations'))) return null
  await acquireUserBillingIdentityLock(tx, userId)
  const [existing] = await tx
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
  if (existing) return null
  const [owner] = await tx
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!owner) return null
  const now = new Date()
  await tx.insert(organization).values({
    id: organizationId,
    name: personalOrganizationName(owner),
    slug: personalOrganizationSlug(userId),
    kind: 'personal',
    metadata: {},
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(member).values({
    id: generateId(),
    userId,
    organizationId,
    role: 'owner',
    createdAt: now,
  })
  await enqueuePersonalOrganizationAuditTx(tx, {
    change: 'created',
    organizationId,
    userId,
    metadata: {},
  })
  return organizationId
}

/**
 * Returns every workspace of a personal organization (archived ones too) to the organization-less
 * personal state it had before personal organizations: no organization on the workspace or its
 * Project, the same billed account, and so the same payer — no storage ledger moves.
 */
export async function detachPersonalOrganizationWorkspacesTx(
  tx: DbTransaction,
  personalOrganizationId: string
): Promise<string[]> {
  const rows = await tx
    .select({ id: workspace.id, billedAccountUserId: workspace.billedAccountUserId })
    .from(workspace)
    .where(eq(workspace.organizationId, personalOrganizationId))
    .orderBy(asc(workspace.id))
    .for('no key update')
  const workspaceIds = rows.map((row) => row.id)
  if (workspaceIds.length === 0) return []
  await transferWorkspaceProjects(
    tx,
    workspaceIds,
    null,
    undefined,
    rows.map((row) => ({
      workspaceId: row.id,
      organizationId: null,
      billedAccountUserId: row.billedAccountUserId,
      expectedCurrentPayer: {
        organizationId: personalOrganizationId,
        billedAccountUserId: row.billedAccountUserId,
      },
    }))
  )
  await tx
    .update(workspace)
    .set({ organizationAssignedAt: null, updatedAt: new Date() })
    .where(inArray(workspace.id, workspaceIds))
  return workspaceIds
}

export interface ConvertPersonalOrganizationResult {
  organizationId: string
  memberId: string
  /** Now organization-less personal workspaces, for the caller's usual attach to pick up. */
  detachedWorkspaceIds: string[]
}

/**
 * Turns the owner's personal organization into the team they are starting (a Team upgrade, an
 * Enterprise owner claim or issuance, an admin-created organization), keeping its id and with it
 * every organization-level chat, file, memory space and setting. Its workspaces first return to
 * the organization-less personal state, so the caller attaches exactly the workspaces it attaches
 * today and moves their billing to the new subscription the same way. Null when the user has no
 * personal organization.
 */
export async function convertPersonalOrganizationToTeamTx(
  tx: DbTransaction,
  {
    userId,
    name,
    slug,
    metadata,
  }: { userId: string; name: string; slug: string; metadata: Record<string, unknown> }
): Promise<ConvertPersonalOrganizationResult | null> {
  await acquireUserBillingIdentityLock(tx, userId)
  const [personal] = await tx
    .select({ organizationId: member.organizationId, memberId: member.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.kind, 'personal')))
    .limit(1)
  if (!personal) return null
  await lockPersonalOrganizationTx(tx, personal.organizationId)

  const detachedWorkspaceIds = await detachPersonalOrganizationWorkspacesTx(
    tx,
    personal.organizationId
  )
  await tx
    .update(organization)
    .set({ kind: 'team', name, slug, metadata, updatedAt: new Date() })
    .where(eq(organization.id, personal.organizationId))

  await enqueuePersonalOrganizationAuditTx(tx, {
    change: 'converted',
    organizationId: personal.organizationId,
    userId,
    metadata: { detachedWorkspaceIds },
  })
  logger.info('Converted personal organization into a team', {
    userId,
    organizationId: personal.organizationId,
    detachedWorkspaceCount: detachedWorkspaceIds.length,
  })
  return {
    organizationId: personal.organizationId,
    memberId: personal.memberId,
    detachedWorkspaceIds,
  }
}

/**
 * What retiring a personal organization does with each organization-scoped table, decided by who
 * can see its rows. Collisions with the target cannot refuse a join (SSO JIT, SCIM, invitation
 * acceptance and admin adds all reach it), and nothing the person kept to themselves may become
 * visible to the team they join.
 *
 * - {@link OWNER_PRIVATE_CONTENT} is read only by its owner (every read filters on the owner's user
 *   id as well as the organization): organization chats and their runs, memory spaces, benchmarks.
 *   It moves into the target unchanged, still visible only to its owner. None of these tables holds
 *   a unique key scoped by organization, so moving can never collide.
 * - {@link KEYED_OWNER_STATE} is per-person state keyed within the organization. It moves except
 *   where the person already holds a row under the same key in the target, which stays
 *   authoritative.
 * - {@link ORGANIZATION_BOUND_CONTENT} is shared with every member, or belongs to something that is:
 *   the organization's Search index (its knowledge base, connector caches, per-member connector
 *   state, external directory mirrors and the connections that sync it), its go links, its managed
 *   MCP servers, credential grants and connect drafts on its connections, its Search MCP activity
 *   log, access-request opt-out and the access requests filed against it. Moving any of it would
 *   publish it to the team (and collide with the team's own Search index and go link names), and
 *   none of it has a workspace to stay with or any meaning outside the organization, so it is
 *   deleted with the personal organization; stored objects of its files and documents are queued
 *   for cleanup in the same transaction.
 */
const OWNER_PRIVATE_CONTENT: ReadonlyArray<{ table: PgTable; organizationId: PgColumn }> = [
  { table: copilotChats, organizationId: copilotChats.organizationId },
  { table: copilotRuns, organizationId: copilotRuns.organizationId },
  { table: mothershipMemorySpaces, organizationId: mothershipMemorySpaces.organizationId },
  { table: mothershipBenchmarks, organizationId: mothershipBenchmarks.organizationId },
]

const KEYED_OWNER_STATE: ReadonlyArray<{
  table: PgTable
  organizationId: PgColumn
  key: PgColumn[]
}> = [
  {
    table: mothershipMemorySelections,
    organizationId: mothershipMemorySelections.organizationId,
    key: [mothershipMemorySelections.userId],
  },
  {
    table: organizationSearchHistory,
    organizationId: organizationSearchHistory.organizationId,
    key: [organizationSearchHistory.userId],
  },
  {
    table: copilotOrganizationRequestStops,
    organizationId: copilotOrganizationRequestStops.organizationId,
    key: [copilotOrganizationRequestStops.userId, copilotOrganizationRequestStops.streamId],
  },
]

/** Deleted in this order, dependents before what they reference. */
const ORGANIZATION_BOUND_CONTENT: ReadonlyArray<{ table: PgTable; organizationId: PgColumn }> = [
  { table: assistantToolPermission, organizationId: assistantToolPermission.organizationId },
  { table: pendingCredentialDraft, organizationId: pendingCredentialDraft.organizationId },
  { table: knowledgeConnectorMember, organizationId: knowledgeConnectorMember.organizationId },
  { table: knowledgeBase, organizationId: knowledgeBase.organizationId },
  { table: knowledgeExternalGroup, organizationId: knowledgeExternalGroup.organizationId },
  { table: knowledgeExternalDirectory, organizationId: knowledgeExternalDirectory.organizationId },
  { table: workspaceFiles, organizationId: workspaceFiles.organizationId },
  { table: mcpServerOauth, organizationId: mcpServerOauth.organizationId },
  { table: mcpServers, organizationId: mcpServers.organizationId },
  { table: credential, organizationId: credential.organizationId },
  { table: simLink, organizationId: simLink.organizationId },
  {
    table: organizationSearchMcpInvocation,
    organizationId: organizationSearchMcpInvocation.organizationId,
  },
  {
    table: organizationAccessRequestSettings,
    organizationId: organizationAccessRequestSettings.organizationId,
  },
  { table: permissionAccessRequest, organizationId: permissionAccessRequest.organizationId },
]

/** Rows each table moved into the target or had deleted, keyed by table name. */
export type OrganizationContentCounts = Record<string, number>

async function countedTx(tx: DbTransaction, statement: SQL): Promise<number> {
  const [{ count }] = await tx.execute<{ count: number }>(
    sql`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS count FROM changed`
  )
  return count
}

async function moveOrganizationContentTx(
  tx: DbTransaction,
  from: string,
  to: string
): Promise<{ moved: OrganizationContentCounts; deleted: OrganizationContentCounts }> {
  const moved: OrganizationContentCounts = {}
  const deleted: OrganizationContentCounts = {}
  for (const { table, organizationId } of OWNER_PRIVATE_CONTENT) {
    moved[getTableName(table)] = await countedTx(
      tx,
      sql`UPDATE ${table} SET ${sql.identifier(organizationId.name)} = ${to} WHERE ${organizationId} = ${from}`
    )
  }
  for (const { table, organizationId, key } of KEYED_OWNER_STATE) {
    const keyMatch = sql.join(
      key.map((column) => sql`existing.${sql.identifier(column.name)} = ${column}`),
      sql` AND `
    )
    moved[getTableName(table)] = await countedTx(
      tx,
      sql`
        UPDATE ${table} SET ${sql.identifier(organizationId.name)} = ${to}
        WHERE ${organizationId} = ${from}
          AND NOT EXISTS (
            SELECT 1 FROM ${table} AS existing
            WHERE existing.${sql.identifier(organizationId.name)} = ${to} AND ${keyMatch}
          )
      `
    )
    await tx.execute(sql`DELETE FROM ${table} WHERE ${organizationId} = ${from}`)
  }
  await enqueueOrganizationStoredObjectCleanup(tx, from)
  for (const { table, organizationId } of ORGANIZATION_BOUND_CONTENT) {
    deleted[getTableName(table)] = await countedTx(
      tx,
      sql`DELETE FROM ${table} WHERE ${organizationId} = ${from}`
    )
  }
  /**
   * A pending invitation to a personal workspace keeps inviting to it, recorded without an
   * organization as an organization-less workspace's invitation is; one to the personal
   * organization itself has nothing left to admit anyone to.
   */
  await tx
    .update(invitation)
    .set({ organizationId: null, updatedAt: new Date() })
    .where(and(eq(invitation.organizationId, from), eq(invitation.kind, 'workspace')))
  await tx.delete(invitation).where(eq(invitation.organizationId, from))
  return { moved, deleted }
}

interface CascadingReference {
  schema: string
  table: string
  column: string
}

let cascadingReferences: Promise<CascadingReference[]> | undefined

/**
 * Every single-column foreign key that deletes its rows with an organization, membership aside,
 * read from the catalog once per process (the schema only changes with a release), on the first
 * retirement's transaction. A composite one
 * could not be checked by organization id alone, so it fails loudly rather than being skipped.
 */
function loadCascadingReferences(tx: DbTransaction): Promise<CascadingReference[]> {
  cascadingReferences ??= tx
    .execute<{ schema_name: string; table_name: string; column_name: string; columns: number }>(sql`
      SELECT n.nspname AS schema_name, t.relname AS table_name, a.attname AS column_name,
        cardinality(c.conkey) AS columns
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'organization'::regclass
        AND c.confdeltype = 'c'
        AND t.relname <> 'member'
      ORDER BY 1, 2, 3
    `)
    .then((rows) => {
      const composite = rows.find((row) => row.columns > 1)
      if (composite) {
        throw new Error(`Composite cascading organization reference on ${composite.table_name}`)
      }
      return rows.map((row) => ({
        schema: row.schema_name,
        table: row.table_name,
        column: row.column_name,
      }))
    })
    .catch((error: unknown) => {
      cascadingReferences = undefined
      throw error
    })
  return cascadingReferences
}

/**
 * Proves nothing would cascade away with the personal organization: every table whose rows its
 * deletion would delete must hold none of them by now (its membership aside), checked in one
 * statement. Every such table is moved, keyed, deleted as organization-bound (above), or refused on
 * personal organizations by migrations 0456 and 0457 (`personal-organization-join.integration.ts`
 * proves the classification is complete), so this only refuses a join over rows written around
 * those guards, rather than losing them.
 */
async function assertNothingCascadesTx(tx: DbTransaction, organizationId: string) {
  const members = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))
    .limit(2)
  if (members.length > 1) {
    throw new OrchestrationError('conflict', 'A personal organization has more than one member.')
  }
  const references = await loadCascadingReferences(tx)
  if (references.length === 0) return
  const probes = sql.join(
    references.map(
      ({ schema, table, column }) => sql`
        SELECT ${table}::text AS table_name WHERE EXISTS (
          SELECT 1 FROM ${sql.identifier(schema)}.${sql.identifier(table)}
          WHERE ${sql.identifier(column)} = ${organizationId}
        )`
    ),
    sql` UNION ALL `
  )
  const [remaining] = await tx.execute<{ table_name: string }>(sql`${probes} LIMIT 1`)
  if (remaining) {
    logger.error('Personal organization holds rows that would cascade away on retirement', {
      organizationId,
      table: remaining.table_name,
    })
    throw new OrchestrationError(
      'conflict',
      "This account's personal organization holds data that cannot move into another organization."
    )
  }
}

export interface RetirePersonalOrganizationResult {
  retiredOrganizationId: string | null
  detachedWorkspaceIds: string[]
  /** Owner-private rows moved into the target, by table. */
  movedCounts: OrganizationContentCounts
  /** Organization-bound rows deleted with the personal organization, by table. */
  deletedCounts: OrganizationContentCounts
}

/**
 * Retires a person's personal organization as they join another organization, so the
 * one-membership-per-user rule holds without refusing the join and without losing anything:
 * their workspaces return to the organization-less personal state they had before personal
 * organizations (still theirs, still private, still billed to them; an invitation acceptance
 * then moves the ones it disclosed, as it always has), their owner-private organization-level
 * content (chats, memory spaces, ...) moves into the organization they join with the same owner,
 * what was shared within the personal organization is deleted with it (see
 * {@link OWNER_PRIVATE_CONTENT}), and only then are the personal membership and organization
 * deleted. Nothing the target holds can refuse the join.
 *
 * The caller holds the target's organization lock and the user's billing-identity lock, which
 * workspace creation in the personal organization also takes. A no-op without a personal
 * organization.
 */
export async function retirePersonalOrganizationTx(
  tx: DbTransaction,
  { userId, targetOrganizationId }: { userId: string; targetOrganizationId: string }
): Promise<RetirePersonalOrganizationResult> {
  const personalOrganizationId = await getPersonalOrganizationId(userId, tx)
  if (!personalOrganizationId) {
    return {
      retiredOrganizationId: null,
      detachedWorkspaceIds: [],
      movedCounts: {},
      deletedCounts: {},
    }
  }
  if (personalOrganizationId === targetOrganizationId) {
    throw new Error('A personal organization cannot be retired into itself')
  }
  await lockPersonalOrganizationTx(tx, personalOrganizationId)

  const detachedWorkspaceIds = await detachPersonalOrganizationWorkspacesTx(
    tx,
    personalOrganizationId
  )
  const { moved, deleted } = await moveOrganizationContentTx(
    tx,
    personalOrganizationId,
    targetOrganizationId
  )
  await assertNothingCascadesTx(tx, personalOrganizationId)
  await tx
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, personalOrganizationId)))
  await tx.delete(organization).where(eq(organization.id, personalOrganizationId))

  await enqueuePersonalOrganizationAuditTx(tx, {
    change: 'retired',
    organizationId: personalOrganizationId,
    userId,
    metadata: {
      targetOrganizationId,
      detachedWorkspaceIds,
      movedCounts: moved,
      deletedCounts: deleted,
    },
  })
  logger.info('Retired personal organization on joining another organization', {
    userId,
    personalOrganizationId,
    targetOrganizationId,
    detachedWorkspaceCount: detachedWorkspaceIds.length,
  })
  return {
    retiredOrganizationId: personalOrganizationId,
    detachedWorkspaceIds,
    movedCounts: moved,
    deletedCounts: deleted,
  }
}
