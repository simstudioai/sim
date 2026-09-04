import { db } from '@sim/db'
import { knowledgeExternalGroup, knowledgeExternalGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, eq, notInArray, sql } from 'drizzle-orm'
import { EXTERNAL_GROUP_SYNC_INTERVAL_MS } from '@/lib/knowledge/access/external-groups'
import { canonicalGroupId } from '@/lib/knowledge/access/tokens'
import type {
  ConnectorConfig,
  ConnectorDirectory,
  ConnectorDirectoryGroup,
} from '@/connectors/types'

const logger = createLogger('ExternalGroupSync')

/** Member rows written per statement while replacing a group's membership. */
const MEMBER_WRITE_BATCH_SIZE = 500

export interface DirectorySyncResult {
  /** Groups whose membership was replaced from a complete enumeration. */
  refreshed: number
  /** Groups left on their previous membership because this run could not read them in full. */
  keptStale: number
  /** Groups the directory no longer has, removed along with their membership. */
  pruned: number
  /** True when the sync was skipped because the directory was read recently enough. */
  skipped: boolean
}

/**
 * Refreshes the external directory groups of one workspace, for one provider
 * and tenant.
 *
 * The unit of work is a group, not the directory: a group whose membership
 * enumerates completely is replaced, and one that does not is left exactly as
 * it was. That is the whole difference from Onyx, whose group sync marks every
 * row stale, upserts whatever the source returned, and sweeps the rest — clean
 * until the directory half-fails, at which point it revokes access from real
 * members whose rows simply were not returned that run. Here a directory outage
 * costs freshness and nothing else, and
 * `EXTERNAL_GROUP_STALE_AFTER_MS` is what stops that patience becoming
 * permanent.
 */
export async function syncExternalDirectoryGroups(input: {
  workspaceId: string
  providerId: string
  directory: ConnectorDirectory
}): Promise<DirectorySyncResult> {
  const { workspaceId, providerId, directory } = input
  const tenantId = directory.tenantId

  if (await directoryReadRecently(workspaceId, providerId, tenantId)) {
    return { refreshed: 0, keptStale: 0, pruned: 0, skipped: true }
  }

  const groups = await directory.listGroups()
  logger.info('Enumerating directory groups', {
    workspaceId,
    providerId,
    tenantId,
    groups: groups.length,
  })

  let refreshed = 0
  let keptStale = 0
  for (const group of groups) {
    const groupId = await upsertGroup({ workspaceId, providerId, tenantId, group })
    try {
      const membership = await directory.listGroupMembers(group)
      if (!membership.complete) {
        keptStale += 1
        logger.warn('Keeping last-known-good membership for a partially enumerated group', {
          workspaceId,
          providerId,
          externalGroupId: group.id,
        })
        continue
      }
      await replaceGroupMembers(groupId, membership.memberEmails)
      refreshed += 1
    } catch (error) {
      keptStale += 1
      logger.warn('Keeping last-known-good membership for a group that failed to enumerate', {
        workspaceId,
        providerId,
        externalGroupId: group.id,
        error: getErrorMessage(error),
      })
    }
  }

  const pruned = await pruneRemovedGroups({
    workspaceId,
    providerId,
    tenantId,
    keep: groups.map((group) => canonicalGroupId(group.id)),
  })

  return { refreshed, keptStale, pruned, skipped: false }
}

/**
 * Whether every group of this directory was confirmed within the sync interval.
 *
 * Keyed off the *least* recently synced group, so one group that failed keeps
 * the directory due rather than being masked by its healthy siblings.
 */
async function directoryReadRecently(
  workspaceId: string,
  providerId: string,
  tenantId: string
): Promise<boolean> {
  const freshEnough = new Date(Date.now() - EXTERNAL_GROUP_SYNC_INTERVAL_MS)
  const [counts] = await db
    .select({
      total: count(),
      stale: count(
        sql`CASE WHEN ${knowledgeExternalGroup.lastSyncedAt} IS NULL OR ${knowledgeExternalGroup.lastSyncedAt} < ${sql.param(freshEnough, knowledgeExternalGroup.lastSyncedAt)} THEN 1 END`
      ),
    })
    .from(knowledgeExternalGroup)
    .where(
      and(
        eq(knowledgeExternalGroup.workspaceId, workspaceId),
        eq(knowledgeExternalGroup.providerId, providerId),
        eq(knowledgeExternalGroup.tenantId, tenantId)
      )
    )

  /** No groups at all is a directory that has never been read, not a fresh one. */
  return counts.total > 0 && counts.stale === 0
}

async function upsertGroup(input: {
  workspaceId: string
  providerId: string
  tenantId: string
  group: ConnectorDirectoryGroup
}): Promise<string> {
  const { workspaceId, providerId, tenantId, group } = input
  const [row] = await db
    .insert(knowledgeExternalGroup)
    .values({
      id: generateId(),
      workspaceId,
      providerId,
      tenantId,
      externalGroupId: canonicalGroupId(group.id),
    })
    .onConflictDoUpdate({
      target: [
        knowledgeExternalGroup.workspaceId,
        knowledgeExternalGroup.providerId,
        knowledgeExternalGroup.tenantId,
        knowledgeExternalGroup.externalGroupId,
      ],
      set: { updatedAt: new Date() },
    })
    .returning({ id: knowledgeExternalGroup.id })
  return row.id
}

/**
 * Replaces a group's membership with a complete enumeration, and marks it
 * confirmed.
 *
 * One transaction, so a reader never sees a group mid-rewrite — briefly empty
 * would mean briefly revoked for everyone in it. `lastSyncedAt` moves only
 * here, on the path that had the whole membership in hand.
 */
async function replaceGroupMembers(groupId: string, emails: string[]): Promise<void> {
  const unique = [...new Set(emails)]
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .delete(knowledgeExternalGroupMember)
      .where(eq(knowledgeExternalGroupMember.groupId, groupId))

    for (let offset = 0; offset < unique.length; offset += MEMBER_WRITE_BATCH_SIZE) {
      await tx
        .insert(knowledgeExternalGroupMember)
        .values(
          unique
            .slice(offset, offset + MEMBER_WRITE_BATCH_SIZE)
            .map((email) => ({ groupId, email }))
        )
    }

    await tx
      .update(knowledgeExternalGroup)
      .set({ lastSyncedAt: now, updatedAt: now })
      .where(eq(knowledgeExternalGroup.id, groupId))
  })
}

/**
 * Removes groups this directory no longer has, cascading their membership.
 *
 * Only ever called with the result of a complete `listGroups`, which every
 * directory implements to throw rather than return a partial page — deleting
 * groups because a listing was truncated would revoke everyone in them.
 */
async function pruneRemovedGroups(input: {
  workspaceId: string
  providerId: string
  tenantId: string
  keep: readonly string[]
}): Promise<number> {
  const removed = await db
    .delete(knowledgeExternalGroup)
    .where(
      and(
        eq(knowledgeExternalGroup.workspaceId, input.workspaceId),
        eq(knowledgeExternalGroup.providerId, input.providerId),
        eq(knowledgeExternalGroup.tenantId, input.tenantId),
        ...(input.keep.length > 0
          ? [notInArray(knowledgeExternalGroup.externalGroupId, [...input.keep])]
          : [])
      )
    )
    .returning({ id: knowledgeExternalGroup.id })
  return removed.length
}

/**
 * Refreshes the directory groups the mirrored ACLs refer to.
 *
 * A `g:` token grants nobody until the directory says who is in that group, so
 * the refresh runs in the same pass that writes the tokens — a crawl can never
 * publish grants against membership this workspace has never read.
 *
 * It is rate-limited on its own clock rather than the connector's, so a
 * frequently-syncing connector does not re-read the whole directory every run.
 * A failure is logged rather than thrown: last-known-good membership is still
 * serving reads, and failing the content sync over it would strand the
 * documents as well as the groups.
 */
export async function refreshMirroredDirectory(input: {
  workspaceId: string
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  accessToken: string
}): Promise<void> {
  const { workspaceId, connectorConfig } = input
  if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.openDirectory) return

  try {
    const directory = await connectorConfig.openDirectory(
      input.accessToken,
      input.sourceConfig,
      input.syncContext
    )
    if (!directory) {
      logger.warn('Skipping directory refresh: the connector names no directory', {
        workspaceId,
        connector: connectorConfig.id,
      })
      return
    }
    const result = await syncExternalDirectoryGroups({
      workspaceId,
      providerId: connectorConfig.auth.provider,
      directory,
    })
    logger.info('Refreshed mirrored directory groups', {
      workspaceId,
      tenantId: directory.tenantId,
      ...result,
    })
  } catch (error) {
    logger.error('Directory refresh failed; serving last-known-good group membership', {
      workspaceId,
      connector: connectorConfig.id,
      error: getErrorMessage(error),
    })
  }
}
