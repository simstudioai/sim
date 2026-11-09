import { db } from '@sim/db'
import {
  assistantToolPermission,
  copilotChats,
  copilotOrganizationRequestStops,
  copilotRuns,
  credential,
  customBlock,
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
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, getTableName, inArray, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/identity-lock'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
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
 * Returns null, writing nothing, when they already belong to one or no longer exist. Takes the
 * user's billing-identity lock, the fence every membership change holds.
 */
export async function createPersonalOrganizationTx(
  tx: DbTransaction,
  userId: string,
  organizationId = `org_${generateId()}`
): Promise<string | null> {
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

/** Organization-level content a person owns, which follows them into the organization they join. */
const OWNED_ORGANIZATION_CONTENT: ReadonlyArray<{ table: PgTable; organizationId: PgColumn }> = [
  { table: copilotChats, organizationId: copilotChats.organizationId },
  { table: copilotRuns, organizationId: copilotRuns.organizationId },
  { table: workspaceFiles, organizationId: workspaceFiles.organizationId },
  { table: knowledgeBase, organizationId: knowledgeBase.organizationId },
  { table: mothershipMemorySpaces, organizationId: mothershipMemorySpaces.organizationId },
  { table: mothershipBenchmarks, organizationId: mothershipBenchmarks.organizationId },
  { table: mcpServers, organizationId: mcpServers.organizationId },
  { table: mcpServerOauth, organizationId: mcpServerOauth.organizationId },
  { table: credential, organizationId: credential.organizationId },
  { table: simLink, organizationId: simLink.organizationId },
  { table: assistantToolPermission, organizationId: assistantToolPermission.organizationId },
  { table: pendingCredentialDraft, organizationId: pendingCredentialDraft.organizationId },
  /** A members-mode connector's per-member sync state, which follows its knowledge base. */
  { table: knowledgeConnectorMember, organizationId: knowledgeConnectorMember.organizationId },
]

/**
 * Rows keyed within their organization: they move too, except where the target already holds a row
 * under the same key, which stays authoritative. Per-person state the person holds in the target
 * from an earlier membership, and the mirrors of an external identity directory the moved
 * knowledge bases' connectors read (the target's mirror of the same directory is equivalent, and
 * the next connector sync refreshes it).
 */
const KEYED_ORGANIZATION_STATE: ReadonlyArray<{
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
  {
    table: knowledgeExternalDirectory,
    organizationId: knowledgeExternalDirectory.organizationId,
    key: [knowledgeExternalDirectory.providerId, knowledgeExternalDirectory.tenantId],
  },
  {
    table: knowledgeExternalGroup,
    organizationId: knowledgeExternalGroup.organizationId,
    key: [
      knowledgeExternalGroup.providerId,
      knowledgeExternalGroup.tenantId,
      knowledgeExternalGroup.externalGroupId,
    ],
  },
]

/**
 * Rows meaningful only inside the personal organization, which nothing in the target could read:
 * its Search MCP activity log, its access-request opt-out, and the access requests filed against
 * it (personal workspaces leave for the organization-less state, where access requests never
 * existed). They go with it.
 */
const PERSONAL_ORGANIZATION_ONLY: ReadonlyArray<{ table: PgTable; organizationId: PgColumn }> = [
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

async function moveOrganizationContentTx(tx: DbTransaction, from: string, to: string) {
  for (const { table, organizationId } of OWNED_ORGANIZATION_CONTENT) {
    /** A savepoint, so a name or account the target already holds refuses the join cleanly. */
    try {
      await tx.transaction((savepoint) =>
        savepoint.execute(sql`
          UPDATE ${table} SET ${sql.identifier(organizationId.name)} = ${to}
          WHERE ${organizationId} = ${from}
        `)
      )
    } catch (error) {
      if (getPostgresErrorCode(error) !== '23505') throw error
      throw new OrchestrationError(
        'conflict',
        `Something in this account's personal organization (${getTableName(table)}) has the same name as something in the organization being joined. Rename or remove it, then try again.`
      )
    }
  }
  for (const { table, organizationId, key } of KEYED_ORGANIZATION_STATE) {
    const keyMatch = sql.join(
      key.map((column) => sql`existing.${sql.identifier(column.name)} = ${column}`),
      sql` AND `
    )
    await tx.execute(sql`
      UPDATE ${table} SET ${sql.identifier(organizationId.name)} = ${to}
      WHERE ${organizationId} = ${from}
        AND NOT EXISTS (
          SELECT 1 FROM ${table} AS existing
          WHERE existing.${sql.identifier(organizationId.name)} = ${to} AND ${keyMatch}
        )
    `)
    await tx.execute(sql`DELETE FROM ${table} WHERE ${organizationId} = ${from}`)
  }
  for (const { table, organizationId } of PERSONAL_ORGANIZATION_ONLY) {
    await tx.execute(sql`DELETE FROM ${table} WHERE ${organizationId} = ${from}`)
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
}

/**
 * Proves nothing would cascade away with the personal organization: every table whose rows its
 * deletion would delete must hold none of them by now (its membership aside). Every such table is
 * moved, keyed, personal-only (above), or refused on personal organizations by migrations 0456 and
 * 0457 (`personal-organizations.integration.ts` proves the classification is complete), so this
 * only refuses a join over rows written around those guards, rather than losing them.
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
  const references = await tx.execute<{ table_name: string; column_name: string }>(sql`
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'organization'::regclass
      AND c.confdeltype = 'c'
      AND cardinality(c.conkey) = 1
  `)
  for (const reference of references) {
    if (reference.table_name === 'member') continue
    const remaining = await tx.execute(sql`
      SELECT 1 FROM ${sql.raw(reference.table_name)}
      WHERE ${sql.identifier(reference.column_name)} = ${organizationId}
      LIMIT 1
    `)
    if (remaining.length > 0) {
      throw new OrchestrationError(
        'conflict',
        `This account's personal organization holds ${reference.table_name} data that cannot move into another organization.`
      )
    }
  }
}

export interface RetirePersonalOrganizationResult {
  retiredOrganizationId: string | null
  detachedWorkspaceIds: string[]
}

/**
 * Retires a person's personal organization as they join another organization, so the
 * one-membership-per-user rule holds without refusing the join and without losing anything:
 * their workspaces return to the organization-less personal state they had before personal
 * organizations (still theirs, still private, still billed to them; an invitation acceptance
 * then moves the ones it disclosed, as it always has), their organization-level content (chats,
 * files, knowledge bases, memory spaces, ...) moves into the organization they join with the same
 * owner, and only then are the personal membership and organization deleted.
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
  if (!personalOrganizationId) return { retiredOrganizationId: null, detachedWorkspaceIds: [] }
  if (personalOrganizationId === targetOrganizationId) {
    throw new Error('A personal organization cannot be retired into itself')
  }
  await lockPersonalOrganizationTx(tx, personalOrganizationId)

  const [publishedBlock] = await tx
    .select({ id: customBlock.id })
    .from(customBlock)
    .where(eq(customBlock.organizationId, personalOrganizationId))
    .limit(1)
  if (publishedBlock) {
    throw new OrchestrationError(
      'conflict',
      'Custom blocks published from your personal workspaces would run inside the organization you are joining while those workspaces stay private. Unpublish them, then try again.'
    )
  }

  const detachedWorkspaceIds = await detachPersonalOrganizationWorkspacesTx(
    tx,
    personalOrganizationId
  )
  await moveOrganizationContentTx(tx, personalOrganizationId, targetOrganizationId)
  await assertNothingCascadesTx(tx, personalOrganizationId)
  await tx
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, personalOrganizationId)))
  await tx.delete(organization).where(eq(organization.id, personalOrganizationId))

  logger.info('Retired personal organization on joining another organization', {
    userId,
    personalOrganizationId,
    targetOrganizationId,
    detachedWorkspaceCount: detachedWorkspaceIds.length,
  })
  return { retiredOrganizationId: personalOrganizationId, detachedWorkspaceIds }
}
