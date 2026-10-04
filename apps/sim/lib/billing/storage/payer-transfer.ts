import {
  document,
  knowledgeBase,
  knowledgeConnector,
  organization,
  project,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import type { ProjectStorageOwnerSnapshot } from '@/lib/billing/storage/context'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { lockProject } from '@/lib/projects/membership'

const logger = createLogger('WorkspaceStoragePayerTransfer')

interface ExactWorkspaceStorageRow {
  [key: string]: unknown
  document_bytes: number | string
  workspace_file_bytes: number | string
  workspace_file_missing_size_count: number | string
}

interface BatchExactWorkspaceStorageRow extends ExactWorkspaceStorageRow {
  workspace_id: string
}

export interface WorkspaceStoragePayer {
  billedAccountUserId: string
  organizationId: string | null
}

export interface ChangeWorkspaceStoragePayerParams extends WorkspaceStoragePayer {
  workspaceId: string
  expectedCurrentPayer?: WorkspaceStoragePayer
}

export interface ChangeWorkspaceStoragePayerResult {
  billableBytes: number
  newPayer: BillingEntity
  oldPayer: BillingEntity
  repairedWorkspaceLedger: boolean
}

export interface ChangeProjectStoragePayerParams extends ProjectStorageOwnerSnapshot {
  expectedCurrentOwner: Pick<ProjectStorageOwnerSnapshot, 'ownerId' | 'organizationId'>
}

interface ChangeProjectStoragePayerResult {
  projectId: string
  billableBytes: number
  oldPayer: BillingEntity
  newPayer: BillingEntity
}

interface RemovedProjectStorageContribution {
  projectId: string
  billableBytes: number
  payer: BillingEntity
}

interface PayerStorageDelta {
  incomingBytes: number
  outgoingBytes: number
}

function getWorkspacePayer(row: WorkspaceStoragePayer): BillingEntity {
  return row.organizationId
    ? { type: 'organization', id: row.organizationId }
    : { type: 'user', id: row.billedAccountUserId }
}

function getPayerKey(payer: BillingEntity): string {
  return `${payer.type}:${payer.id}`
}

function comparePayerKeys(left: string, right: string): number {
  const [leftType, leftId] = left.split(':', 2)
  const [rightType, rightId] = right.split(':', 2)
  if (leftType !== rightType) {
    return leftType === 'user' ? -1 : 1
  }
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function parseExactBytes(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} storage total: ${String(value)}`)
  }
  return parsed
}

/**
 * Computes one workspace's live billable bytes with two index-bounded scalar
 * aggregates. Archived workspace files and documents remain billable while
 * their objects are retained; mothership files, connector documents, and
 * deleted documents are excluded. A detaching connector's reservation counts:
 * it was charged when the connector was removed with its documents kept.
 */
async function getExactWorkspaceStorageBytes(tx: DbOrTx, workspaceId: string): Promise<number> {
  const [row] = await tx.execute<ExactWorkspaceStorageRow>(sql`
    SELECT
      COALESCE((
        SELECT SUM(${workspaceFiles.sizeBytes})
        FROM ${workspaceFiles}
        WHERE ${workspaceFiles.workspaceId} = ${workspaceId}
          AND ${workspaceFiles.context} = 'workspace'
      ), 0)::bigint AS workspace_file_bytes,
      (
        SELECT COUNT(*)
        FROM ${workspaceFiles}
        WHERE ${workspaceFiles.workspaceId} = ${workspaceId}
          AND ${workspaceFiles.context} = 'workspace'
          AND ${workspaceFiles.sizeBytes} IS NULL
      )::bigint AS workspace_file_missing_size_count,
      COALESCE((
        SELECT SUM(${document.fileSize}::bigint)
        FROM ${document}
        INNER JOIN ${knowledgeBase}
          ON ${knowledgeBase.id} = ${document.knowledgeBaseId}
        WHERE ${knowledgeBase.workspaceId} = ${workspaceId}
          AND ${document.connectorId} IS NULL
          AND ${document.deletedAt} IS NULL
      ), 0)::bigint + COALESCE((
        SELECT SUM(${knowledgeConnector.detachReservedBytes})
        FROM ${knowledgeConnector}
        INNER JOIN ${knowledgeBase}
          ON ${knowledgeBase.id} = ${knowledgeConnector.knowledgeBaseId}
        WHERE ${knowledgeBase.workspaceId} = ${workspaceId}
          AND ${knowledgeConnector.detachedAt} IS NOT NULL
      ), 0)::bigint AS document_bytes
  `)

  if (!row) {
    throw new Error(`Could not recompute storage for workspace ${workspaceId}`)
  }
  if (parseExactBytes(row.workspace_file_missing_size_count, 'missing workspace file size') > 0) {
    throw new Error(`Workspace ${workspaceId} has files missing canonical size_bytes metadata`)
  }

  const workspaceFileBytes = parseExactBytes(row.workspace_file_bytes, 'workspace file')
  const documentBytes = parseExactBytes(row.document_bytes, 'knowledge document')
  const total = workspaceFileBytes + documentBytes
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Workspace ${workspaceId} storage total exceeds the safe integer range`)
  }
  return total
}

/**
 * Locks a payer row and returns its current aggregate. A missing source can be
 * historical drift and is represented as `null`; callers must reject a
 * missing destination. `FOR NO KEY UPDATE` avoids upgrading the implicit
 * foreign-key `FOR KEY SHARE` this transaction may already hold; see the
 * module header of `lib/billing/storage/tracking.ts`.
 */
async function lockStoragePayer(tx: DbOrTx, payer: BillingEntity): Promise<number | null> {
  if (payer.type === 'organization') {
    const [row] = await tx
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, payer.id))
      .for('no key update')
      .limit(1)
    return row?.storageUsedBytes ?? null
  }

  const [row] = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, payer.id))
    .for('no key update')
    .limit(1)
  return row?.storageUsedBytes ?? null
}

async function setStoragePayerUsage(
  tx: DbOrTx,
  payer: BillingEntity,
  storageUsedBytes: number
): Promise<void> {
  if (payer.type === 'organization') {
    await tx.update(organization).set({ storageUsedBytes }).where(eq(organization.id, payer.id))
    return
  }

  await tx.update(userStats).set({ storageUsedBytes }).where(eq(userStats.userId, payer.id))
}

/**
 * Computes exact live storage totals for all payer-changing workspaces with one
 * grouped query. Workspaces absent from both aggregate branches correctly
 * remain at zero.
 */
async function getExactWorkspaceStorageBytesBatch(
  tx: DbOrTx,
  workspaceIds: string[]
): Promise<Map<string, number>> {
  const exactBytesByWorkspaceId = new Map(workspaceIds.map((workspaceId) => [workspaceId, 0]))
  if (workspaceIds.length === 0) return exactBytesByWorkspaceId

  const rows = await tx.execute<BatchExactWorkspaceStorageRow>(sql`
    SELECT
      storage_by_workspace.workspace_id,
      COALESCE(SUM(storage_by_workspace.workspace_file_bytes), 0)::bigint
        AS workspace_file_bytes,
      COALESCE(SUM(storage_by_workspace.document_bytes), 0)::bigint
        AS document_bytes,
      COALESCE(SUM(storage_by_workspace.workspace_file_missing_size_count), 0)::bigint
        AS workspace_file_missing_size_count
    FROM (
      SELECT
        ${workspaceFiles.workspaceId} AS workspace_id,
        SUM(${workspaceFiles.sizeBytes}) AS workspace_file_bytes,
        0::bigint AS document_bytes,
        COUNT(*) FILTER (WHERE ${workspaceFiles.sizeBytes} IS NULL)::bigint
          AS workspace_file_missing_size_count
      FROM ${workspaceFiles}
      WHERE ${inArray(workspaceFiles.workspaceId, workspaceIds)}
        AND ${workspaceFiles.context} = 'workspace'
      GROUP BY ${workspaceFiles.workspaceId}

      UNION ALL

      SELECT
        ${knowledgeBase.workspaceId} AS workspace_id,
        0::bigint AS workspace_file_bytes,
        SUM(${document.fileSize}::bigint) AS document_bytes,
        0::bigint AS workspace_file_missing_size_count
      FROM ${document}
      INNER JOIN ${knowledgeBase}
        ON ${knowledgeBase.id} = ${document.knowledgeBaseId}
      WHERE ${inArray(knowledgeBase.workspaceId, workspaceIds)}
        AND ${document.connectorId} IS NULL
        AND ${document.deletedAt} IS NULL
      GROUP BY ${knowledgeBase.workspaceId}

      UNION ALL

      SELECT
        ${knowledgeBase.workspaceId} AS workspace_id,
        0::bigint AS workspace_file_bytes,
        SUM(${knowledgeConnector.detachReservedBytes}) AS document_bytes,
        0::bigint AS workspace_file_missing_size_count
      FROM ${knowledgeConnector}
      INNER JOIN ${knowledgeBase}
        ON ${knowledgeBase.id} = ${knowledgeConnector.knowledgeBaseId}
      WHERE ${inArray(knowledgeBase.workspaceId, workspaceIds)}
        AND ${knowledgeConnector.detachedAt} IS NOT NULL
      GROUP BY ${knowledgeBase.workspaceId}
    ) storage_by_workspace
    GROUP BY storage_by_workspace.workspace_id
    ORDER BY storage_by_workspace.workspace_id
  `)

  for (const row of rows) {
    if (parseExactBytes(row.workspace_file_missing_size_count, 'missing workspace file size') > 0) {
      throw new Error(
        `Workspace ${row.workspace_id} has files missing canonical size_bytes metadata`
      )
    }
    const workspaceFileBytes = parseExactBytes(row.workspace_file_bytes, 'workspace file')
    const documentBytes = parseExactBytes(row.document_bytes, 'knowledge document')
    const total = workspaceFileBytes + documentBytes
    if (!Number.isSafeInteger(total)) {
      throw new Error(`Workspace ${row.workspace_id} storage total exceeds the safe integer range`)
    }
    exactBytesByWorkspaceId.set(row.workspace_id, total)
  }

  return exactBytesByWorkspaceId
}

/**
 * Locks all distinct payer rows with every user payer first, followed by every
 * organization payer, and ascending IDs within each payer type.
 */
async function lockStoragePayers(
  tx: DbOrTx,
  payerByKey: Map<string, BillingEntity>
): Promise<Map<string, number | null>> {
  const usageByKey = new Map<string, number | null>(
    [...payerByKey.keys()].map((key) => [key, null])
  )
  const sortedPayers = [...payerByKey.entries()].sort(([left], [right]) =>
    comparePayerKeys(left, right)
  )
  const userIds = sortedPayers
    .filter(([, payer]) => payer.type === 'user')
    .map(([, payer]) => payer.id)
  const organizationIds = sortedPayers
    .filter(([, payer]) => payer.type === 'organization')
    .map(([, payer]) => payer.id)

  if (userIds.length > 0) {
    const rows = await tx
      .select({ id: userStats.userId, storageUsedBytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(inArray(userStats.userId, userIds))
      .orderBy(asc(userStats.userId))
      .for('no key update')
    for (const row of rows) {
      usageByKey.set(getPayerKey({ type: 'user', id: row.id }), row.storageUsedBytes)
    }
  }

  if (organizationIds.length > 0) {
    const rows = await tx
      .select({ id: organization.id, storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(inArray(organization.id, organizationIds))
      .orderBy(asc(organization.id))
      .for('no key update')
    for (const row of rows) {
      usageByKey.set(getPayerKey({ type: 'organization', id: row.id }), row.storageUsedBytes)
    }
  }

  return usageByKey
}

/**
 * Applies all payer aggregate updates with one conditional update per payer
 * table.
 */
async function setStoragePayerUsagesBatch(
  tx: DbOrTx,
  payerByKey: Map<string, BillingEntity>,
  nextUsageByKey: Map<string, number>
): Promise<void> {
  const sortedUpdates = [...nextUsageByKey.entries()].sort(([left], [right]) =>
    comparePayerKeys(left, right)
  )
  const organizationUpdates = sortedUpdates.flatMap(([key, storageUsedBytes]) => {
    const payer = payerByKey.get(key)
    return payer?.type === 'organization' ? [{ payerId: payer.id, storageUsedBytes }] : []
  })
  const userUpdates = sortedUpdates.flatMap(([key, storageUsedBytes]) => {
    const payer = payerByKey.get(key)
    return payer?.type === 'user' ? [{ payerId: payer.id, storageUsedBytes }] : []
  })

  if (userUpdates.length > 0) {
    await tx
      .update(userStats)
      .set({
        storageUsedBytes: sql`CASE ${userStats.userId} ${sql.join(
          userUpdates.map(
            ({ payerId, storageUsedBytes }) => sql`WHEN ${payerId} THEN ${storageUsedBytes}`
          ),
          sql.raw(' ')
        )} ELSE ${userStats.storageUsedBytes} END`,
      })
      .where(
        inArray(
          userStats.userId,
          userUpdates.map(({ payerId }) => payerId)
        )
      )
  }

  if (organizationUpdates.length > 0) {
    await tx
      .update(organization)
      .set({
        storageUsedBytes: sql`CASE ${organization.id} ${sql.join(
          organizationUpdates.map(
            ({ payerId, storageUsedBytes }) => sql`WHEN ${payerId} THEN ${storageUsedBytes}`
          ),
          sql.raw(' ')
        )} ELSE ${organization.storageUsedBytes} END`,
      })
      .where(
        inArray(
          organization.id,
          organizationUpdates.map(({ payerId }) => payerId)
        )
      )
  }
}

/**
 * Changes multiple workspace payers in one short caller-owned transaction.
 *
 * Workspace rows are locked in ascending ID order, exact live byte totals are
 * grouped into one query, and distinct payer rows are locked with all users
 * before all organizations and ascending IDs within each type. Source and
 * destination deltas are aggregated separately so an underfunded source is
 * clamped before incoming bytes are added. No destination quota is enforced.
 */
export async function changeWorkspaceStoragePayersInTx(
  tx: DbOrTx,
  changes: ChangeWorkspaceStoragePayerParams[]
): Promise<ChangeWorkspaceStoragePayerResult[]> {
  return changeWorkspaceStoragePayers(tx, changes, false)
}

async function changeWorkspaceStoragePayers(
  tx: DbOrTx,
  changes: ChangeWorkspaceStoragePayerParams[],
  deferPayerUpdates: boolean
): Promise<ChangeWorkspaceStoragePayerResult[]> {
  if (changes.length === 0) return []

  const changesByWorkspaceId = new Map(
    changes.map((change) => [change.workspaceId, change] as const)
  )
  if (changesByWorkspaceId.size !== changes.length) {
    throw new Error('Storage payer batch contains duplicate workspace IDs')
  }

  const workspaceIds = [...changesByWorkspaceId.keys()].sort()
  const lockedWorkspaces = await tx
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
      storageUsedBytes: workspace.storageUsedBytes,
    })
    .from(workspace)
    .where(inArray(workspace.id, workspaceIds))
    .orderBy(asc(workspace.id))
    .for('no key update')

  const workspaceById = new Map(lockedWorkspaces.map((row) => [row.id, row]))
  for (const workspaceId of workspaceIds) {
    const lockedWorkspace = workspaceById.get(workspaceId)
    const change = changesByWorkspaceId.get(workspaceId)
    if (!lockedWorkspace || !change) {
      throw new Error(`Workspace ${workspaceId} not found during storage payer change`)
    }
    if (
      change.expectedCurrentPayer &&
      (lockedWorkspace.organizationId !== change.expectedCurrentPayer.organizationId ||
        lockedWorkspace.billedAccountUserId !== change.expectedCurrentPayer.billedAccountUserId)
    ) {
      throw new Error(`Workspace ${workspaceId} payer changed before the transaction lock`)
    }
  }

  const payerByKey = new Map<string, BillingEntity>()
  const payerChangingWorkspaceIds: string[] = []
  for (const workspaceId of workspaceIds) {
    const lockedWorkspace = workspaceById.get(workspaceId)
    const change = changesByWorkspaceId.get(workspaceId)
    if (!lockedWorkspace || !change) continue
    const oldPayer = getWorkspacePayer(lockedWorkspace)
    const newPayer = getWorkspacePayer(change)
    if (getPayerKey(oldPayer) === getPayerKey(newPayer)) continue
    payerChangingWorkspaceIds.push(workspaceId)
    payerByKey.set(getPayerKey(oldPayer), oldPayer)
    payerByKey.set(getPayerKey(newPayer), newPayer)
  }

  const exactBytesByWorkspaceId = await getExactWorkspaceStorageBytesBatch(
    tx,
    payerChangingWorkspaceIds
  )
  if (!deferPayerUpdates) {
    const payerUsageByKey = await lockStoragePayers(tx, payerByKey)
    const deltaByPayerKey = new Map<string, PayerStorageDelta>()

    for (const workspaceId of payerChangingWorkspaceIds) {
      const lockedWorkspace = workspaceById.get(workspaceId)
      const change = changesByWorkspaceId.get(workspaceId)
      if (!lockedWorkspace || !change) continue
      const exactBytes = exactBytesByWorkspaceId.get(workspaceId) ?? 0
      const oldPayer = getWorkspacePayer(lockedWorkspace)
      const newPayer = getWorkspacePayer(change)
      const oldPayerKey = getPayerKey(oldPayer)
      const newPayerKey = getPayerKey(newPayer)

      if (payerUsageByKey.get(newPayerKey) === null) {
        throw new Error(`Storage destination payer ${newPayerKey} not found`)
      }

      const sourceDelta = deltaByPayerKey.get(oldPayerKey) ?? {
        incomingBytes: 0,
        outgoingBytes: 0,
      }
      sourceDelta.outgoingBytes += exactBytes
      if (!Number.isSafeInteger(sourceDelta.outgoingBytes)) {
        throw new Error(`Storage source payer ${oldPayerKey} delta exceeds the safe integer range`)
      }
      deltaByPayerKey.set(oldPayerKey, sourceDelta)

      const destinationDelta = deltaByPayerKey.get(newPayerKey) ?? {
        incomingBytes: 0,
        outgoingBytes: 0,
      }
      destinationDelta.incomingBytes += exactBytes
      if (!Number.isSafeInteger(destinationDelta.incomingBytes)) {
        throw new Error(
          `Storage destination payer ${newPayerKey} delta exceeds the safe integer range`
        )
      }
      deltaByPayerKey.set(newPayerKey, destinationDelta)
    }

    const nextUsageByKey = new Map<string, number>()
    for (const [payerKey, delta] of [...deltaByPayerKey.entries()].sort(([left], [right]) =>
      comparePayerKeys(left, right)
    )) {
      const currentUsage = payerUsageByKey.get(payerKey)
      if (currentUsage === null || currentUsage === undefined) {
        logger.warn('Storage source payer is missing during workspace payer batch change', {
          sourcePayer: payerKey,
          outgoingBytes: delta.outgoingBytes,
        })
        continue
      }

      const usageAfterOutgoing = Math.max(0, currentUsage - delta.outgoingBytes)
      if (currentUsage < delta.outgoingBytes) {
        logger.warn(
          'Clamping drifted source storage aggregate during workspace payer batch change',
          {
            sourcePayer: payerKey,
            sourceUsage: currentUsage,
            outgoingBytes: delta.outgoingBytes,
          }
        )
      }
      const nextUsage = usageAfterOutgoing + delta.incomingBytes
      if (!Number.isSafeInteger(nextUsage)) {
        throw new Error(`Storage payer ${payerKey} exceeds the safe integer range`)
      }
      nextUsageByKey.set(payerKey, nextUsage)
    }

    await setStoragePayerUsagesBatch(tx, payerByKey, nextUsageByKey)
  }

  const resultsByWorkspaceId = new Map<string, ChangeWorkspaceStoragePayerResult>()
  const workspaceUpdates = workspaceIds.map((workspaceId) => {
    const lockedWorkspace = workspaceById.get(workspaceId)
    const change = changesByWorkspaceId.get(workspaceId)
    if (!lockedWorkspace || !change) {
      throw new Error(`Workspace ${workspaceId} disappeared during storage payer change`)
    }
    const oldPayer = getWorkspacePayer(lockedWorkspace)
    const newPayer = getWorkspacePayer(change)
    const payerChanged = getPayerKey(oldPayer) !== getPayerKey(newPayer)
    const billableBytes = payerChanged
      ? (exactBytesByWorkspaceId.get(workspaceId) ?? 0)
      : lockedWorkspace.storageUsedBytes
    const repairedWorkspaceLedger =
      payerChanged && lockedWorkspace.storageUsedBytes !== billableBytes
    resultsByWorkspaceId.set(workspaceId, {
      billableBytes,
      newPayer,
      oldPayer,
      repairedWorkspaceLedger,
    })
    return { ...change, storageUsedBytes: billableBytes }
  })

  await tx
    .update(workspace)
    .set({
      billedAccountUserId: sql`CASE ${workspace.id} ${sql.join(
        workspaceUpdates.map(
          (update) => sql`WHEN ${update.workspaceId} THEN ${update.billedAccountUserId}`
        ),
        sql.raw(' ')
      )} ELSE ${workspace.billedAccountUserId} END`,
      organizationId: sql`CASE ${workspace.id} ${sql.join(
        workspaceUpdates.map(
          (update) => sql`WHEN ${update.workspaceId} THEN ${update.organizationId}`
        ),
        sql.raw(' ')
      )} ELSE ${workspace.organizationId} END`,
      storageUsedBytes: sql`CASE ${workspace.id} ${sql.join(
        workspaceUpdates.map(
          (update) => sql`WHEN ${update.workspaceId} THEN ${update.storageUsedBytes}`
        ),
        sql.raw(' ')
      )} ELSE ${workspace.storageUsedBytes} END`,
    })
    .where(inArray(workspace.id, workspaceIds))

  logger.info('Changed workspace storage payers in batch', {
    workspaceCount: workspaceIds.length,
    payerChangingWorkspaceCount: payerChangingWorkspaceIds.length,
  })

  return changes.map((change) => {
    const result = resultsByWorkspaceId.get(change.workspaceId)
    if (!result) {
      throw new Error(`Workspace ${change.workspaceId} result missing after storage payer change`)
    }
    return result
  })
}

/**
 * Updates organization-workspace billed-account metadata without touching
 * storage ledgers. The organization remains the payer, so one conditional
 * update is both the concurrency check and the complete mutation.
 */
export async function changeOrganizationWorkspaceBilledAccountsInTx(
  tx: DbOrTx,
  params: {
    organizationId: string
    expectedCurrentBilledAccountUserId: string
    billedAccountUserId: string
  }
): Promise<string[]> {
  await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, params.organizationId),
        eq(workspace.billedAccountUserId, params.expectedCurrentBilledAccountUserId)
      )
    )
    .orderBy(asc(workspace.id))
    .for('no key update')

  const rows = await tx
    .update(workspace)
    .set({ billedAccountUserId: params.billedAccountUserId })
    .where(
      and(
        eq(workspace.organizationId, params.organizationId),
        eq(workspace.billedAccountUserId, params.expectedCurrentBilledAccountUserId)
      )
    )
    .returning({ id: workspace.id })

  return rows.map((row) => row.id)
}

/**
 * Changes one workspace's storage payer inside the caller's short database
 * transaction.
 *
 * The workspace row is locked first. If its billing entity is unchanged, only
 * payer metadata is updated; no aggregate query or payer lock is needed.
 * Otherwise, live bytes are recomputed and distinct old/new payer rows are
 * locked with users before organizations and ascending IDs within each type.
 * The exact live workspace total is assigned to the workspace ledger and
 * transferred without a destination quota check. Historical source drift is
 * repaired conservatively by clamping an underfunded source to zero; a missing
 * destination always fails the transaction.
 */
export async function changeWorkspaceStoragePayerInTx(
  tx: DbOrTx,
  params: ChangeWorkspaceStoragePayerParams
): Promise<ChangeWorkspaceStoragePayerResult> {
  const [lockedWorkspace] = await tx
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
      storageUsedBytes: workspace.storageUsedBytes,
    })
    .from(workspace)
    .where(eq(workspace.id, params.workspaceId))
    .for('no key update')
    .limit(1)

  if (!lockedWorkspace) {
    throw new Error(`Workspace ${params.workspaceId} not found during storage payer change`)
  }

  if (
    params.expectedCurrentPayer &&
    (lockedWorkspace.organizationId !== params.expectedCurrentPayer.organizationId ||
      lockedWorkspace.billedAccountUserId !== params.expectedCurrentPayer.billedAccountUserId)
  ) {
    throw new Error(`Workspace ${params.workspaceId} payer changed before the transaction lock`)
  }

  const oldPayer = getWorkspacePayer(lockedWorkspace)
  const newPayer = getWorkspacePayer(params)
  const oldPayerKey = getPayerKey(oldPayer)
  const newPayerKey = getPayerKey(newPayer)

  if (oldPayerKey === newPayerKey) {
    await tx
      .update(workspace)
      .set({
        billedAccountUserId: params.billedAccountUserId,
        organizationId: params.organizationId,
      })
      .where(eq(workspace.id, params.workspaceId))

    logger.info('Updated workspace storage payer metadata', {
      workspaceId: params.workspaceId,
      payer: oldPayerKey,
    })

    return {
      billableBytes: lockedWorkspace.storageUsedBytes,
      newPayer,
      oldPayer,
      repairedWorkspaceLedger: false,
    }
  }

  const exactBytes = await getExactWorkspaceStorageBytes(tx, params.workspaceId)
  const payerByKey = new Map<string, BillingEntity>([
    [oldPayerKey, oldPayer],
    [newPayerKey, newPayer],
  ])
  const payerUsageByKey = new Map<string, number | null>()
  const sortedPayers = [...payerByKey.entries()].sort(([left], [right]) =>
    comparePayerKeys(left, right)
  )

  for (const [key, payer] of sortedPayers) {
    payerUsageByKey.set(key, await lockStoragePayer(tx, payer))
  }

  const destinationUsage = payerUsageByKey.get(newPayerKey)
  if (destinationUsage === null || destinationUsage === undefined) {
    throw new Error(`Storage destination payer ${newPayerKey} not found`)
  }

  const repairedWorkspaceLedger = lockedWorkspace.storageUsedBytes !== exactBytes
  if (repairedWorkspaceLedger) {
    logger.warn('Repairing workspace storage ledger during payer change', {
      workspaceId: params.workspaceId,
      previousBytes: lockedWorkspace.storageUsedBytes,
      exactBytes,
      oldPayer: oldPayerKey,
      newPayer: newPayerKey,
    })
  }

  const sourceUsage = payerUsageByKey.get(oldPayerKey)
  if (sourceUsage === null || sourceUsage === undefined) {
    logger.warn('Storage source payer is missing during workspace payer change', {
      workspaceId: params.workspaceId,
      sourcePayer: oldPayerKey,
      destinationPayer: newPayerKey,
      transferredBytes: exactBytes,
    })
  } else {
    const nextSourceUsage = Math.max(0, sourceUsage - exactBytes)
    if (sourceUsage < exactBytes) {
      logger.warn('Clamping drifted source storage aggregate during workspace payer change', {
        workspaceId: params.workspaceId,
        sourcePayer: oldPayerKey,
        sourceUsage,
        transferredBytes: exactBytes,
      })
    }
    await setStoragePayerUsage(tx, oldPayer, nextSourceUsage)
  }

  const nextDestinationUsage = destinationUsage + exactBytes
  if (!Number.isSafeInteger(nextDestinationUsage)) {
    throw new Error(`Storage destination payer ${newPayerKey} exceeds the safe integer range`)
  }
  await setStoragePayerUsage(tx, newPayer, nextDestinationUsage)

  await tx
    .update(workspace)
    .set({
      billedAccountUserId: params.billedAccountUserId,
      organizationId: params.organizationId,
      storageUsedBytes: exactBytes,
    })
    .where(eq(workspace.id, params.workspaceId))

  logger.info('Changed workspace storage payer', {
    workspaceId: params.workspaceId,
    oldPayer: oldPayerKey,
    newPayer: newPayerKey,
    transferredBytes: exactBytes,
    repairedWorkspaceLedger,
  })

  return {
    billableBytes: exactBytes,
    newPayer,
    oldPayer,
    repairedWorkspaceLedger,
  }
}

/**
 * Transfers each Project's retained current heads once and changes its owner in the same
 * transaction. Callers acquire all affected owner locks before any payer or file locks;
 * environment ownership changes required by Project lifecycle checks share this transaction.
 * History is retained without an additional charge, and ownership transfers do not enforce quota.
 */
export async function changeProjectStoragePayersInTx(
  tx: DbTransaction,
  changes: readonly ChangeProjectStoragePayerParams[]
): Promise<ChangeProjectStoragePayerResult[]> {
  return changeProjectStoragePayers(tx, changes, false)
}

async function changeProjectStoragePayers(
  tx: DbTransaction,
  changes: readonly ChangeProjectStoragePayerParams[],
  deferPayerUpdates: boolean
): Promise<ChangeProjectStoragePayerResult[]> {
  if (!changes.length) return []
  const changesById = new Map(changes.map((change) => [change.projectId, change]))
  if (changesById.size !== changes.length)
    throw new Error('Storage payer batch contains duplicate Project IDs')
  const projectIds = [...changesById.keys()].sort()
  for (const id of projectIds) await lockProject(tx, id)
  const owners = await tx
    .select({ id: project.id, ownerId: project.ownerId, organizationId: project.organizationId })
    .from(project)
    .where(inArray(project.id, projectIds))
    .orderBy(asc(project.id))
    .for('update')
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]))
  const resultById = new Map<string, ChangeProjectStoragePayerResult>()
  for (const id of projectIds) {
    const owner = ownersById.get(id)
    const change = changesById.get(id)
    if (!owner || !change) throw new Error(`Project ${id} not found during storage payer change`)
    if (
      owner.ownerId !== change.expectedCurrentOwner.ownerId ||
      owner.organizationId !== change.expectedCurrentOwner.organizationId
    )
      throw new Error(`Project ${id} owner changed before the transaction lock`)
    const oldPayer: BillingEntity = owner.organizationId
      ? { type: 'organization', id: owner.organizationId }
      : { type: 'user', id: owner.ownerId }
    const newPayer: BillingEntity = change.organizationId
      ? { type: 'organization', id: change.organizationId }
      : { type: 'user', id: change.ownerId }
    resultById.set(id, { projectId: id, billableBytes: 0, oldPayer, newPayer })
  }
  const totals = await getExactProjectStorageBytes(tx, projectIds)
  for (const [projectId, bytes] of totals) {
    const result = resultById.get(projectId)
    if (!result) throw new Error('Unexpected Project storage aggregate')
    result.billableBytes = bytes
  }
  if (!deferPayerUpdates) {
    await applyPayerContributionTransfers(tx, [...resultById.values()])
  }

  for (const id of projectIds) {
    const change = changesById.get(id)
    if (!change) throw new Error(`Project ${id} change is missing`)
    await tx
      .update(project)
      .set({
        ownerId: change.ownerId,
        organizationId: change.organizationId,
        updatedAt: new Date(),
      })
      .where(eq(project.id, id))
  }
  return changes.map((change) => {
    const result = resultById.get(change.projectId)
    if (!result) throw new Error(`Project ${change.projectId} result is missing`)
    return result
  })
}

async function getExactProjectStorageBytes(tx: DbTransaction, projectIds: string[]) {
  const bytesById = new Map<string, number>(projectIds.map((id) => [id, 0]))
  if (!projectIds.length) return bytesById
  const totals = await tx
    .select({
      projectId: workspaceFiles.entityId,
      bytes: sql<string>`coalesce(sum(${workspaceFiles.sizeBytes}), 0)::text`,
      invalidCount: sql<number>`count(*) FILTER (WHERE ${workspaceFiles.sizeBytes} IS NULL OR ${workspaceFiles.sizeBytes} < 0)::integer`,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.entityType, 'project'),
        eq(workspaceFiles.context, 'project'),
        inArray(workspaceFiles.entityId, projectIds)
      )
    )
    .groupBy(workspaceFiles.entityId)
  for (const total of totals) {
    if (!total.projectId || total.invalidCount > 0)
      throw new Error('Project has invalid canonical size metadata')
    if (!bytesById.has(total.projectId)) throw new Error('Unexpected Project storage aggregate')
    bytesById.set(total.projectId, parseExactBytes(total.bytes, 'Project file'))
  }
  return bytesById
}

/** Source repair clamps the entire outgoing batch before any incoming contribution is added. */
async function applyPayerContributionTransfers(
  tx: DbTransaction,
  contributions: readonly {
    billableBytes: number
    oldPayer: BillingEntity
    newPayer: BillingEntity | null
  }[]
): Promise<void> {
  const payerByKey = new Map<string, BillingEntity>()
  for (const { oldPayer, newPayer } of contributions) {
    if (newPayer && getPayerKey(oldPayer) === getPayerKey(newPayer)) continue
    payerByKey.set(getPayerKey(oldPayer), oldPayer)
    if (newPayer) payerByKey.set(getPayerKey(newPayer), newPayer)
  }
  const usageByKey = await lockStoragePayers(tx, payerByKey)
  const deltas = new Map<string, PayerStorageDelta>()
  for (const result of contributions) {
    const sourceKey = getPayerKey(result.oldPayer)
    const destinationKey = result.newPayer ? getPayerKey(result.newPayer) : null
    if (sourceKey === destinationKey) continue
    if (destinationKey && usageByKey.get(destinationKey) == null)
      throw new Error(`Storage destination payer ${destinationKey} not found`)
    const source = deltas.get(sourceKey) ?? { incomingBytes: 0, outgoingBytes: 0 }
    source.outgoingBytes += result.billableBytes
    deltas.set(sourceKey, source)
    if (destinationKey) {
      const destination = deltas.get(destinationKey) ?? { incomingBytes: 0, outgoingBytes: 0 }
      destination.incomingBytes += result.billableBytes
      deltas.set(destinationKey, destination)
    }
  }
  const nextUsageByKey = new Map<string, number>()
  for (const [key, delta] of deltas) {
    if (!Number.isSafeInteger(delta.incomingBytes) || !Number.isSafeInteger(delta.outgoingBytes)) {
      throw new Error(`Storage payer ${key} delta exceeds the safe integer range`)
    }
    const current = usageByKey.get(key)
    if (current == null) {
      logger.warn('Storage source payer is missing during Project ownership transfer', {
        payer: key,
        outgoingBytes: delta.outgoingBytes,
      })
      continue
    }
    if (current < delta.outgoingBytes) {
      logger.warn('Clamping drifted resource source storage aggregate', {
        payer: key,
        currentBytes: current,
        outgoingBytes: delta.outgoingBytes,
      })
    }
    const next = Math.max(0, current - delta.outgoingBytes) + delta.incomingBytes
    if (!Number.isSafeInteger(next))
      throw new Error(`Storage payer ${key} total exceeds the safe integer range`)
    nextUsageByKey.set(key, next)
  }
  await setStoragePayerUsagesBatch(tx, payerByKey, nextUsageByKey)
}

/** Locks every owner, then every payer, before folding lifecycle transfers and removals once. */
export async function changeProjectAndWorkspaceStoragePayersInTx(
  tx: DbTransaction,
  changes: {
    projectChanges: readonly ChangeProjectStoragePayerParams[]
    workspaceChanges: ChangeWorkspaceStoragePayerParams[]
    /** The caller retires these Projects and their objects in this same transaction. */
    projectRemovals?: readonly ProjectStorageOwnerSnapshot[]
  }
): Promise<{
  projects: ChangeProjectStoragePayerResult[]
  workspaces: ChangeWorkspaceStoragePayerResult[]
  removedProjects: RemovedProjectStorageContribution[]
}> {
  const removals = changes.projectRemovals ?? []
  const projectIds = [...changes.projectChanges, ...removals]
    .map((change) => change.projectId)
    .sort()
  if (new Set(projectIds).size !== projectIds.length)
    throw new Error('Storage lifecycle batch contains duplicate Project IDs')
  for (const id of projectIds) await lockProject(tx, id)
  const projects = projectIds.length
    ? await tx
        .select({
          id: project.id,
          ownerId: project.ownerId,
          organizationId: project.organizationId,
        })
        .from(project)
        .where(inArray(project.id, projectIds))
        .orderBy(asc(project.id))
        .for('update')
    : []
  const projectById = new Map(projects.map((owner) => [owner.id, owner]))
  const workspaceIds = [
    ...new Set(changes.workspaceChanges.map((change) => change.workspaceId)),
  ].sort()
  const workspaces = workspaceIds.length
    ? await tx
        .select({
          id: workspace.id,
          billedAccountUserId: workspace.billedAccountUserId,
          organizationId: workspace.organizationId,
        })
        .from(workspace)
        .where(inArray(workspace.id, workspaceIds))
        .orderBy(asc(workspace.id))
        .for('no key update')
    : []
  const workspaceById = new Map(workspaces.map((owner) => [owner.id, owner]))
  const payerByKey = new Map<string, BillingEntity>()
  const removedProjects: RemovedProjectStorageContribution[] = []
  for (const removal of removals) {
    const owner = projectById.get(removal.projectId)
    if (
      !owner ||
      owner.ownerId !== removal.ownerId ||
      owner.organizationId !== removal.organizationId
    )
      throw new Error(`Project ${removal.projectId} owner changed before retirement`)
    const payer: BillingEntity = owner.organizationId
      ? { type: 'organization', id: owner.organizationId }
      : { type: 'user', id: owner.ownerId }
    payerByKey.set(getPayerKey(payer), payer)
    removedProjects.push({ projectId: removal.projectId, billableBytes: 0, payer })
  }
  for (const change of changes.projectChanges) {
    const owner = projectById.get(change.projectId)
    if (!owner) throw new Error(`Project ${change.projectId} not found during storage payer change`)
    for (const value of [owner, change]) {
      const payer: BillingEntity = value.organizationId
        ? { type: 'organization', id: value.organizationId }
        : { type: 'user', id: value.ownerId }
      payerByKey.set(getPayerKey(payer), payer)
    }
  }
  for (const change of changes.workspaceChanges) {
    const owner = workspaceById.get(change.workspaceId)
    if (!owner)
      throw new Error(`Workspace ${change.workspaceId} not found during storage payer change`)
    for (const value of [owner, change]) {
      const payer = getWorkspacePayer(value)
      payerByKey.set(getPayerKey(payer), payer)
    }
  }
  await lockStoragePayers(tx, payerByKey)
  const removedBytes = await getExactProjectStorageBytes(
    tx,
    removals.map((removal) => removal.projectId)
  )
  for (const removal of removedProjects) {
    const bytes = removedBytes.get(removal.projectId)
    if (bytes === undefined) throw new Error('Project retirement storage total is missing')
    removal.billableBytes = bytes
  }
  const projectResults = await changeProjectStoragePayers(tx, changes.projectChanges, true)
  const workspaceResults = await changeWorkspaceStoragePayers(tx, changes.workspaceChanges, true)
  await applyPayerContributionTransfers(tx, [
    ...projectResults,
    ...workspaceResults,
    ...removedProjects.map((removal) => ({
      billableBytes: removal.billableBytes,
      oldPayer: removal.payer,
      newPayer: null,
    })),
  ])
  return { projects: projectResults, workspaces: workspaceResults, removedProjects }
}
