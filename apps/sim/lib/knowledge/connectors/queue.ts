import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { tasks } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('ConnectorSyncQueue')

export interface ConnectorSyncPayload {
  connectorId: string
  fullSync?: boolean
  /**
   * Force re-hydration + re-indexing of already-synced documents for connectors
   * whose rendered content can drift without a hash change (see
   * `ConnectorMeta.rehydrateOnFullSync`). Unlike `fullSync`, this does NOT alter
   * listing or bypass any deletion-reconciliation safety guard.
   */
  rehydrate?: boolean
  requestId: string
  billingAttribution: BillingAttributionSnapshot
}

export interface DispatchSyncOptions {
  billingAttribution: BillingAttributionSnapshot
  fullSync?: boolean
  rehydrate?: boolean
  requestId?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Restores and validates connector work crossing the asynchronous boundary.
 */
export function assertConnectorSyncPayload(value: unknown): ConnectorSyncPayload {
  if (!isRecordLike(value)) {
    throw new Error('Connector sync payload must be an object')
  }
  if (!isNonEmptyString(value.connectorId) || !isNonEmptyString(value.requestId)) {
    throw new Error('Connector sync payload requires connectorId and requestId')
  }
  if (value.fullSync !== undefined && typeof value.fullSync !== 'boolean') {
    throw new Error('Connector sync payload fullSync must be a boolean when provided')
  }
  if (value.rehydrate !== undefined && typeof value.rehydrate !== 'boolean') {
    throw new Error('Connector sync payload rehydrate must be a boolean when provided')
  }
  if (value.billingAttribution === undefined) {
    throw new Error('Connector sync payload requires billing attribution')
  }

  return {
    connectorId: value.connectorId,
    fullSync: value.fullSync as boolean | undefined,
    rehydrate: value.rehydrate as boolean | undefined,
    requestId: value.requestId,
    billingAttribution: assertBillingAttributionSnapshot(value.billingAttribution),
  }
}

/**
 * Dispatches a connector sync with billing attribution already fixed by the
 * authenticated or scheduled entry point.
 */
export async function dispatchSync(
  connectorId: string,
  options: DispatchSyncOptions
): Promise<void> {
  if (!isNonEmptyString(connectorId)) {
    throw new Error('Connector sync dispatch requires a connector ID')
  }

  const requestId = options?.requestId ?? generateId()
  const payload = assertConnectorSyncPayload({
    connectorId,
    fullSync: options?.fullSync,
    rehydrate: options?.rehydrate,
    requestId,
    billingAttribution: options?.billingAttribution,
  })

  const connectorRows = await db
    .select({
      knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
      connectorArchivedAt: knowledgeConnector.archivedAt,
      connectorDeletedAt: knowledgeConnector.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      kbDeletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)

  const row = connectorRows[0]
  if (!row) {
    logger.warn('Skipping sync dispatch: connector not found', { connectorId, requestId })
    return
  }
  if (row.kbDeletedAt) {
    logger.warn('Skipping sync dispatch: knowledge base is deleted', {
      connectorId,
      knowledgeBaseId: row.knowledgeBaseId,
      requestId,
    })
    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        nextSyncAt: null,
        lastSyncError: 'Knowledge base deleted',
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return
  }
  if (row.connectorArchivedAt || row.connectorDeletedAt) {
    logger.warn('Skipping sync dispatch: connector is archived or deleted', {
      connectorId,
      requestId,
    })
    return
  }
  if (!row.workspaceId) {
    throw new Error(`Connector ${connectorId} is missing workspace billing context`)
  }
  if (payload.billingAttribution.workspaceId !== row.workspaceId) {
    throw new Error(
      `Connector sync billing attribution does not match connector workspace ${row.workspaceId}`
    )
  }

  const tags = [
    `connectorId:${connectorId}`,
    `knowledgeBaseId:${row.knowledgeBaseId}`,
    `workspaceId:${row.workspaceId}`,
    `userId:${payload.billingAttribution.actorUserId}`,
  ]

  if (isTriggerAvailable()) {
    await tasks.trigger('knowledge-connector-sync', payload, {
      tags,
      region: await resolveTriggerRegion(),
    })
    logger.info('Dispatched connector sync to Trigger.dev', { connectorId, requestId })
    return
  }

  executeSync(connectorId, {
    fullSync: payload.fullSync,
    rehydrate: payload.rehydrate,
    billingAttribution: payload.billingAttribution,
  }).catch((error) => {
    logger.error(`Sync failed for connector ${connectorId}`, {
      error: toError(error).message,
      requestId,
    })
  })
}
