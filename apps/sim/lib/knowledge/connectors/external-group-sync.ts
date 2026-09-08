import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeExternalDirectory,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import {
  resourceScopeColumns,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import type { DbTransaction } from '@/lib/db/types'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { EXTERNAL_GROUP_SYNC_INTERVAL_MS } from '@/lib/knowledge/access/external-groups'
import { canonicalGroupId, isIdentityToken } from '@/lib/knowledge/access/tokens'
import { mirrorsSourceAcls } from '@/lib/knowledge/connectors/access-modes'
import {
  resolveConnectorAccessToken,
  resolveConnectorTokenUserId,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import { RUNNABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'
import { isRateLimitError } from '@/lib/knowledge/documents/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type {
  ConnectorConfig,
  ConnectorDirectory,
  ConnectorDirectoryGroup,
  ConnectorDirectoryMembership,
} from '@/connectors/types'

const logger = createLogger('ExternalGroupSync')

/** Member rows written per statement while replacing a group's membership. */
const MEMBER_WRITE_BATCH_SIZE = 500
export const DIRECTORY_ERROR_PREFIX = 'Directory refresh failed: '

interface DirectorySyncResult {
  /** Groups whose membership was replaced from a complete enumeration. */
  refreshed: number
  /** Groups left on their previous membership because this run could not read them in full. */
  keptStale: number
  /** Groups the directory no longer has, removed along with their membership. */
  pruned: number
  /** The directory is already complete and fresh, or another worker holds its lease. */
  skipped: boolean
  error?: Error
}

/** The lease covers the directory worker's maximum provider wait; every write checks expiry. */
const DIRECTORY_LEASE_MS = 30 * 60 * 1000
const GROUP_DELETE_BATCH_SIZE = 500

type DirectoryIdentity = Pick<ConnectorDirectory, 'providerId' | 'tenantId'> & {
  workspaceId?: string
  organizationId?: string
}
interface DirectoryLease extends DirectoryIdentity {
  token: string
}

function directoryIdentity(identity: DirectoryIdentity) {
  return and(
    resourceScopeCondition(knowledgeExternalDirectory, resourceScopeFromOwner(identity)),
    eq(knowledgeExternalDirectory.providerId, identity.providerId),
    eq(knowledgeExternalDirectory.tenantId, identity.tenantId)
  )
}

function unexpiredDirectoryLease(lease: DirectoryLease) {
  return and(
    directoryIdentity(lease),
    eq(knowledgeExternalDirectory.syncLockToken, lease.token),
    gt(
      knowledgeExternalDirectory.syncLockLeaseAt,
      sql`clock_timestamp() - ${DIRECTORY_LEASE_MS} * interval '1 millisecond'`
    )
  )
}

/** Short transactions fence every write against both replacement and expiry of its directory lease. */
async function withDirectoryLease<T>(
  lease: DirectoryLease,
  write: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const [held] = await tx
      .update(knowledgeExternalDirectory)
      .set({ syncLockLeaseAt: sql`clock_timestamp()` })
      .where(unexpiredDirectoryLease(lease))
      .returning({ token: knowledgeExternalDirectory.syncLockToken })
    if (!held) throw new Error('Directory sync lease expired or was replaced')
    return write(tx)
  })
}

async function claimDirectory(
  identity: DirectoryIdentity,
  force: boolean
): Promise<DirectoryLease | null> {
  await db
    .insert(knowledgeExternalDirectory)
    .values({ ...identity, ...resourceScopeColumns(resourceScopeFromOwner(identity)) })
    .onConflictDoNothing()
  const lease = { ...identity, token: generateId() }
  const [claimed] = await db
    .update(knowledgeExternalDirectory)
    .set({
      syncLockToken: lease.token,
      syncLockLeaseAt: sql`clock_timestamp()`,
      lastStartedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        directoryIdentity(identity),
        or(
          isNull(knowledgeExternalDirectory.syncLockToken),
          isNull(knowledgeExternalDirectory.syncLockLeaseAt),
          lt(
            knowledgeExternalDirectory.syncLockLeaseAt,
            sql`clock_timestamp() - ${DIRECTORY_LEASE_MS} * interval '1 millisecond'`
          )
        ),
        force
          ? undefined
          : or(
              isNull(knowledgeExternalDirectory.lastCompleteSyncAt),
              gt(
                knowledgeExternalDirectory.lastStartedAt,
                knowledgeExternalDirectory.lastCompleteSyncAt
              ),
              lt(
                knowledgeExternalDirectory.lastCompleteSyncAt,
                sql`clock_timestamp() - ${EXTERNAL_GROUP_SYNC_INTERVAL_MS} * interval '1 millisecond'`
              )
            )
      )
    )
    .returning({ token: knowledgeExternalDirectory.syncLockToken })
  return claimed ? lease : null
}

/**
 * A directory has one shared writer across all connectors. Completion is recorded
 * only after the full group listing and every membership are confirmed, including
 * empty directories. Interrupted passes cannot turn a fresh subset into completion.
 */
export async function syncExternalDirectoryGroups(input: {
  workspaceId?: string
  organizationId?: string
  directory: ConnectorDirectory
  force?: boolean
}): Promise<DirectorySyncResult> {
  const { workspaceId, directory } = input
  const owner = resourceScopeFields(resourceScopeFromOwner(input))
  const { providerId, tenantId } = directory
  const lease = await claimDirectory({ ...owner, providerId, tenantId }, Boolean(input.force))
  if (!lease) return { refreshed: 0, keptStale: 0, pruned: 0, skipped: true }

  try {
    const groups = await directory.listGroups()
    logger.info('Enumerating directory groups', {
      workspaceId,
      providerId,
      tenantId,
      groups: groups.length,
    })
    let refreshed = 0
    let keptStale = 0
    let firstError: Error | undefined
    for (const group of groups) {
      const groupId = await withDirectoryLease(lease, (tx) =>
        upsertGroup({ ...owner, providerId, tenantId, group }, tx)
      )
      let membership: ConnectorDirectoryMembership
      try {
        membership = await directory.listGroupMembers(group)
      } catch (error) {
        if (isRateLimitError(error)) throw error
        keptStale += 1
        firstError ??= toError(error)
        logger.warn('Keeping last-known-good membership for a group that failed to enumerate', {
          workspaceId,
          providerId,
          externalGroupId: group.id,
          error: getErrorMessage(error),
        })
        continue
      }
      if (!membership.complete) {
        keptStale += 1
        firstError ??= new Error('A group membership listing was incomplete')
        continue
      }
      await withDirectoryLease(lease, (tx) =>
        replaceGroupMembers(groupId, membership.memberTokens, tx)
      )
      refreshed += 1
    }

    const pruned = await pruneRemovedGroups(
      lease,
      groups.map((group) => canonicalGroupId(group.id))
    )
    await withDirectoryLease(lease, async (tx) => {
      await tx
        .update(knowledgeExternalDirectory)
        .set({
          ...(keptStale === 0 ? { lastCompleteSyncAt: sql`clock_timestamp()` } : {}),
          syncLockToken: null,
          syncLockLeaseAt: null,
        })
        .where(directoryIdentity(lease))
    })
    return {
      refreshed,
      keptStale,
      pruned,
      skipped: false,
      ...(firstError && { error: firstError }),
    }
  } finally {
    await db
      .update(knowledgeExternalDirectory)
      .set({ syncLockToken: null, syncLockLeaseAt: null })
      .where(
        and(directoryIdentity(lease), eq(knowledgeExternalDirectory.syncLockToken, lease.token))
      )
  }
}

async function upsertGroup(
  input: DirectoryIdentity & { group: ConnectorDirectoryGroup },
  tx: DbTransaction
): Promise<string> {
  const { workspaceId, providerId, tenantId, group } = input
  const [row] = await tx
    .insert(knowledgeExternalGroup)
    .values({
      id: generateId(),
      ...resourceScopeColumns(resourceScopeFromOwner(input)),
      providerId,
      tenantId,
      externalGroupId: canonicalGroupId(group.id),
    })
    .onConflictDoUpdate({
      target: [
        input.organizationId
          ? knowledgeExternalGroup.organizationId
          : knowledgeExternalGroup.workspaceId,
        knowledgeExternalGroup.providerId,
        knowledgeExternalGroup.tenantId,
        knowledgeExternalGroup.externalGroupId,
      ],
      set: { updatedAt: new Date() },
    })
    .returning({ id: knowledgeExternalGroup.id })
  return row.id
}

/** Membership replacement and its freshness watermark commit together under the directory lease. */
async function replaceGroupMembers(
  groupId: string,
  memberTokens: string[],
  tx: DbTransaction
): Promise<void> {
  if (memberTokens.some((token) => !isIdentityToken(token))) {
    throw new Error('Directory membership contains an invalid identity token')
  }
  await tx
    .delete(knowledgeExternalGroupMember)
    .where(eq(knowledgeExternalGroupMember.groupId, groupId))
  for (const batch of chunkArray([...new Set(memberTokens)], MEMBER_WRITE_BATCH_SIZE)) {
    await tx
      .insert(knowledgeExternalGroupMember)
      .values(batch.map((subjectToken) => ({ groupId, subjectToken })))
  }
  await tx
    .update(knowledgeExternalGroup)
    .set({ lastSyncedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
    .where(eq(knowledgeExternalGroup.id, groupId))
}

/** Only a complete provider group listing may prune; each bounded deletion rechecks ownership. */
async function pruneRemovedGroups(lease: DirectoryLease, keep: readonly string[]): Promise<number> {
  let count = 0
  while (true) {
    const removed = await withDirectoryLease(lease, async (tx) => {
      const rows = await tx
        .select({ id: knowledgeExternalGroup.id })
        .from(knowledgeExternalGroup)
        .where(
          and(
            resourceScopeCondition(knowledgeExternalGroup, resourceScopeFromOwner(lease)),
            eq(knowledgeExternalGroup.providerId, lease.providerId),
            eq(knowledgeExternalGroup.tenantId, lease.tenantId),
            ...(keep.length > 0
              ? [notInArray(knowledgeExternalGroup.externalGroupId, [...keep])]
              : [])
          )
        )
        .limit(GROUP_DELETE_BATCH_SIZE)
      if (rows.length === 0) return 0
      await tx.delete(knowledgeExternalGroup).where(
        inArray(
          knowledgeExternalGroup.id,
          rows.map((row) => row.id)
        )
      )
      return rows.length
    })
    count += removed
    if (removed < GROUP_DELETE_BATCH_SIZE) return count
  }
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
 * Failures retain the last confirmed membership and propagate to the caller's
 * sync status and retry policy.
 */
export async function refreshMirroredDirectory(input: {
  workspaceId?: string
  organizationId?: string
  connectorConfig: ConnectorConfig
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  accessToken: string
  force?: boolean
}): Promise<'refreshed' | 'skipped'> {
  const { workspaceId, connectorConfig } = input
  if (!connectorConfig.openDirectory) return 'skipped'

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
      return 'skipped'
    }
    const result = await syncExternalDirectoryGroups({
      ...resourceScopeFields(resourceScopeFromOwner(input)),
      directory,
      force: input.force,
    })
    if (result.keptStale > 0) {
      throw new Error(`${result.keptStale} group memberships could not be refreshed`, {
        cause: result.error,
      })
    }
    logger.info('Refreshed mirrored directory groups', {
      workspaceId,
      tenantId: directory.tenantId,
      ...result,
    })
    return result.skipped ? 'skipped' : 'refreshed'
  } catch (error) {
    logger.error('Directory refresh failed; serving last-known-good group membership', {
      workspaceId,
      connector: connectorConfig.id,
      error: getErrorMessage(error),
    })
    throw new Error(`${DIRECTORY_ERROR_PREFIX}${getErrorMessage(error)}`, { cause: error })
  }
}

type ConnectorDirectoryRefreshOutcome = 'refreshed' | 'skipped' | 'unusable'

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
      organizationId: knowledgeBase.organizationId,
      knowledgeBaseOwnerId: knowledgeBase.userId,
      updatedAt: knowledgeConnector.updatedAt,
      lastSyncError: knowledgeConnector.lastSyncError,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeConnector.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  if (
    !connector ||
    !mirrorsSourceAcls(connector.accessMode) ||
    (!connector.workspaceId && !connector.organizationId)
  ) {
    return 'skipped'
  }

  if (
    !(
      await resolveKnowledgeAccessAvailability(
        resourceScopeFields(resourceScopeFromOwner(connector))
      )
    ).sourceMirrored
  ) {
    return 'skipped'
  }

  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
  if (!connectorConfig?.openDirectory) return 'skipped'

  const credentialUserId = await resolveConnectorTokenUserId({
    credentialId: connector.credentialId,
    ...resourceScopeFields(resourceScopeFromOwner(connector)),
    fallbackUserId: connector.knowledgeBaseOwnerId,
  })
  if (!credentialUserId) return 'unusable'

  const sourceConfig = connector.sourceConfig as Record<string, unknown>
  const token = await resolveConnectorAccessToken({
    auth: connectorConfig.auth,
    connector,
    userId: credentialUserId,
    requestId,
    sourceConfig,
  })
  if (!token) return 'unusable'

  const recordError = async (lastSyncError: string | null) => {
    await db
      .update(knowledgeConnector)
      .set({ lastSyncError, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeConnector.id, connector.id),
          eq(knowledgeConnector.updatedAt, connector.updatedAt),
          isNull(knowledgeConnector.syncLockToken),
          isNull(knowledgeConnector.memberSyncLockToken),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
  }
  try {
    const outcome = await refreshMirroredDirectory({
      ...resourceScopeFields(resourceScopeFromOwner(connector)),
      connectorConfig,
      sourceConfig,
      syncContext: syncContextForToken(token),
      accessToken: token.accessToken,
      force: connector.lastSyncError?.startsWith(DIRECTORY_ERROR_PREFIX),
    })
    if (outcome === 'refreshed' && connector.lastSyncError?.startsWith(DIRECTORY_ERROR_PREFIX)) {
      await recordError(null)
    }
    return outcome
  } catch (error) {
    await recordError(getErrorMessage(error))
    throw error
  }
}
