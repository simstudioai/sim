import {
  document,
  knowledgeBase,
  organization,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('WorkspaceStoragePayerTransfer')

interface ExactWorkspaceStorageRow {
  [key: string]: unknown
  document_bytes: number | string
  workspace_file_bytes: number | string
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
 * deleted documents are excluded.
 */
async function getExactWorkspaceStorageBytes(tx: DbOrTx, workspaceId: string): Promise<number> {
  const [row] = await tx.execute<ExactWorkspaceStorageRow>(sql`
    SELECT
      COALESCE((
        SELECT SUM(${workspaceFiles.size}::bigint)
        FROM ${workspaceFiles}
        WHERE ${workspaceFiles.workspaceId} = ${workspaceId}
          AND ${workspaceFiles.context} = 'workspace'
      ), 0)::bigint AS workspace_file_bytes,
      COALESCE((
        SELECT SUM(${document.fileSize}::bigint)
        FROM ${document}
        INNER JOIN ${knowledgeBase}
          ON ${knowledgeBase.id} = ${document.knowledgeBaseId}
        WHERE ${knowledgeBase.workspaceId} = ${workspaceId}
          AND ${document.connectorId} IS NULL
          AND ${document.deletedAt} IS NULL
      ), 0)::bigint AS document_bytes
  `)

  if (!row) {
    throw new Error(`Could not recompute storage for workspace ${workspaceId}`)
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
 * missing destination.
 */
async function lockStoragePayer(tx: DbOrTx, payer: BillingEntity): Promise<number | null> {
  if (payer.type === 'organization') {
    const [row] = await tx
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, payer.id))
      .for('update')
      .limit(1)
    return row?.storageUsedBytes ?? null
  }

  const [row] = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, payer.id))
    .for('update')
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
        AS document_bytes
    FROM (
      SELECT
        ${workspaceFiles.workspaceId} AS workspace_id,
        SUM(${workspaceFiles.size}::bigint) AS workspace_file_bytes,
        0::bigint AS document_bytes
      FROM ${workspaceFiles}
      WHERE ${inArray(workspaceFiles.workspaceId, workspaceIds)}
        AND ${workspaceFiles.context} = 'workspace'
      GROUP BY ${workspaceFiles.workspaceId}

      UNION ALL

      SELECT
        ${knowledgeBase.workspaceId} AS workspace_id,
        0::bigint AS workspace_file_bytes,
        SUM(${document.fileSize}::bigint) AS document_bytes
      FROM ${document}
      INNER JOIN ${knowledgeBase}
        ON ${knowledgeBase.id} = ${document.knowledgeBaseId}
      WHERE ${inArray(knowledgeBase.workspaceId, workspaceIds)}
        AND ${document.connectorId} IS NULL
        AND ${document.deletedAt} IS NULL
      GROUP BY ${knowledgeBase.workspaceId}
    ) storage_by_workspace
    GROUP BY storage_by_workspace.workspace_id
    ORDER BY storage_by_workspace.workspace_id
  `)

  for (const row of rows) {
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
      .for('update')
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
      .for('update')
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
    .for('update')

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
      logger.warn('Clamping drifted source storage aggregate during workspace payer batch change', {
        sourcePayer: payerKey,
        sourceUsage: currentUsage,
        outgoingBytes: delta.outgoingBytes,
      })
    }
    const nextUsage = usageAfterOutgoing + delta.incomingBytes
    if (!Number.isSafeInteger(nextUsage)) {
      throw new Error(`Storage payer ${payerKey} exceeds the safe integer range`)
    }
    nextUsageByKey.set(payerKey, nextUsage)
  }

  await setStoragePayerUsagesBatch(tx, payerByKey, nextUsageByKey)

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
    .for('update')

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
    .for('update')
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
