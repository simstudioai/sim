import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, gte, isNull, notInArray } from 'drizzle-orm'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import { EXTERNAL_GROUP_SYNC_INTERVAL_MS } from '@/lib/knowledge/access/external-groups'
import { canonicalGroupId } from '@/lib/knowledge/access/tokens'
import {
  resolveConnectorAccessToken,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
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
  directory: ConnectorDirectory
}): Promise<DirectorySyncResult> {
  const { workspaceId, directory } = input
  const { providerId, tenantId } = directory

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
 * Whether this directory was walked within the sync interval.
 *
 * Keyed off the *most* recently confirmed group: a walk confirms every group
 * it can read, so one confirmed within the interval means the walk ran then.
 * Keying off the least recent would make one group the service account can
 * never read — a permanent 403 — keep the whole directory due forever, and
 * re-walk it every tick. That group still stays on its last-known-good
 * membership and ages out on the read side like any other. No groups at all
 * is a directory that has never been read, not a fresh one.
 */
async function directoryReadRecently(
  workspaceId: string,
  providerId: string,
  tenantId: string
): Promise<boolean> {
  const freshEnough = new Date(Date.now() - EXTERNAL_GROUP_SYNC_INTERVAL_MS)
  const [recent] = await db
    .select({ id: knowledgeExternalGroup.id })
    .from(knowledgeExternalGroup)
    .where(
      and(
        eq(knowledgeExternalGroup.workspaceId, workspaceId),
        eq(knowledgeExternalGroup.providerId, providerId),
        eq(knowledgeExternalGroup.tenantId, tenantId),
        gte(knowledgeExternalGroup.lastSyncedAt, freshEnough)
      )
    )
    .limit(1)
  return Boolean(recent)
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
    const result = await syncExternalDirectoryGroups({ workspaceId, directory })
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

export type ConnectorDirectoryRefreshOutcome = 'refreshed' | 'skipped' | 'unusable'

/**
 * Refreshes the directory one admin-mode connector mirrors, from its row.
 *
 * The scheduler's unit of work, run in the background. Resolves the credential
 * the connector syncs as — the credential's own account owner, not the
 * knowledge base owner, since token reads are scoped to `account.userId` and a
 * service account ignores the argument entirely — and opens the directory with
 * the same context a content sync would.
 */
export async function refreshConnectorDirectory(
  connectorId: string,
  requestId: string
): Promise<ConnectorDirectoryRefreshOutcome> {
  const [connector] = await db
    .select({
      id: knowledgeConnector.id,
      connectorType: knowledgeConnector.connectorType,
      accessMode: knowledgeConnector.accessMode,
      credentialId: knowledgeConnector.credentialId,
      encryptedApiKey: knowledgeConnector.encryptedApiKey,
      sourceConfig: knowledgeConnector.sourceConfig,
      workspaceId: knowledgeBase.workspaceId,
      knowledgeBaseOwnerId: knowledgeBase.userId,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  if (!connector || connector.accessMode !== 'admin' || !connector.workspaceId) return 'skipped'

  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
  if (!connectorConfig?.openDirectory) return 'skipped'

  let credentialUserId = connector.knowledgeBaseOwnerId
  if (connector.credentialId) {
    const identity = await resolveCredentialTokenIdentity(
      connector.credentialId,
      connector.workspaceId
    )
    if (!identity) return 'unusable'
    if (identity.kind === 'oauth') credentialUserId = identity.userId
  }

  const sourceConfig = connector.sourceConfig as Record<string, unknown>
  const token = await resolveConnectorAccessToken({
    auth: connectorConfig.auth,
    connector,
    userId: credentialUserId,
    requestId,
    sourceConfig,
  })
  if (!token) return 'unusable'

  await refreshMirroredDirectory({
    workspaceId: connector.workspaceId,
    connectorConfig,
    sourceConfig,
    syncContext: syncContextForToken(token),
    accessToken: token.accessToken,
  })
  return 'refreshed'
}
