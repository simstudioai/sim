import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { isTriggerAvailable, processDocumentAsync } from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { knowledgeConnectorSync } from '@/background/knowledge-connector-sync'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { DocumentTags, ExternalDocument, SyncResult } from '@/connectors/types'

const logger = createLogger('ConnectorSyncEngine')

/**
 * Resolves tag values from connector metadata using the connector's mapTags function.
 * Translates semantic keys returned by mapTags to actual DB slots using the
 * tagSlotMapping stored in sourceConfig during connector creation.
 */
function resolveTagMapping(
  connectorType: string,
  metadata: Record<string, unknown>,
  sourceConfig?: Record<string, unknown>
): Partial<DocumentTags> | undefined {
  const config = CONNECTOR_REGISTRY[connectorType]
  if (!config?.mapTags || !metadata) return undefined

  const semanticTags = config.mapTags(metadata)
  const mapping = sourceConfig?.tagSlotMapping as Record<string, string> | undefined
  if (!mapping || !semanticTags) return undefined

  const result: Partial<DocumentTags> = {}
  for (const [semanticKey, slot] of Object.entries(mapping)) {
    const value = semanticTags[semanticKey]
    ;(result as Record<string, unknown>)[slot] = value != null ? value : null
  }
  return result
}

/**
 * Dispatch a connector sync — uses Trigger.dev when available,
 * otherwise falls back to direct executeSync.
 */
export async function dispatchSync(
  connectorId: string,
  options?: { fullSync?: boolean; requestId?: string }
): Promise<void> {
  const requestId = options?.requestId ?? crypto.randomUUID()

  if (isTriggerAvailable()) {
    await knowledgeConnectorSync.trigger({
      connectorId,
      fullSync: options?.fullSync,
      requestId,
    })
    logger.info(`Dispatched connector sync to Trigger.dev`, { connectorId, requestId })
  } else {
    executeSync(connectorId, { fullSync: options?.fullSync }).catch((error) => {
      logger.error(`Sync failed for connector ${connectorId}`, {
        error: error instanceof Error ? error.message : String(error),
        requestId,
      })
    })
  }
}

/**
 * Execute a sync for a given knowledge connector.
 *
 * This is the core sync algorithm — connector-agnostic.
 * It looks up the ConnectorConfig from the registry and calls its
 * listDocuments/getDocument methods.
 */
export async function executeSync(
  connectorId: string,
  options?: { fullSync?: boolean }
): Promise<SyncResult> {
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
  }

  const connectorRows = await db
    .select()
    .from(knowledgeConnector)
    .where(and(eq(knowledgeConnector.id, connectorId), isNull(knowledgeConnector.deletedAt)))
    .limit(1)

  if (connectorRows.length === 0) {
    throw new Error(`Connector not found: ${connectorId}`)
  }

  const connector = connectorRows[0]

  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
  if (!connectorConfig) {
    throw new Error(`Unknown connector type: ${connector.connectorType}`)
  }

  const kbRows = await db
    .select({ userId: knowledgeBase.userId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, connector.knowledgeBaseId))
    .limit(1)

  if (kbRows.length === 0) {
    throw new Error(`Knowledge base not found: ${connector.knowledgeBaseId}`)
  }

  const userId = kbRows[0].userId

  const accessToken = await refreshAccessTokenIfNeeded(
    connector.credentialId,
    userId,
    `sync-${connectorId}`
  )

  if (!accessToken) {
    throw new Error('Failed to obtain access token')
  }

  const lockResult = await db
    .update(knowledgeConnector)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(and(eq(knowledgeConnector.id, connectorId), ne(knowledgeConnector.status, 'syncing')))
    .returning({ id: knowledgeConnector.id })

  if (lockResult.length === 0) {
    logger.info('Sync already in progress, skipping', { connectorId })
    return result
  }

  const syncLogId = crypto.randomUUID()
  await db.insert(knowledgeConnectorSyncLog).values({
    id: syncLogId,
    connectorId,
    status: 'started',
    startedAt: new Date(),
  })

  const sourceConfig = connector.sourceConfig as Record<string, unknown>

  try {
    const externalDocs: ExternalDocument[] = []
    let cursor: string | undefined
    let hasMore = true
    const MAX_PAGES = 500
    const syncContext: Record<string, unknown> = {}

    for (let pageNum = 0; hasMore && pageNum < MAX_PAGES; pageNum++) {
      const page = await connectorConfig.listDocuments(
        accessToken,
        sourceConfig,
        cursor,
        syncContext
      )
      externalDocs.push(...page.documents)

      if (page.hasMore && !page.nextCursor) {
        logger.warn('Source returned hasMore=true with no cursor, stopping pagination', {
          connectorId,
          pageNum,
          docsSoFar: externalDocs.length,
        })
        break
      }

      cursor = page.nextCursor
      hasMore = page.hasMore
    }

    logger.info(`Fetched ${externalDocs.length} documents from ${connectorConfig.name}`, {
      connectorId,
    })

    const existingDocs = await db
      .select({
        id: document.id,
        externalId: document.externalId,
        contentHash: document.contentHash,
      })
      .from(document)
      .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))

    const excludedDocs = await db
      .select({ externalId: document.externalId })
      .from(document)
      .where(and(eq(document.connectorId, connectorId), eq(document.userExcluded, true)))

    const excludedExternalIds = new Set(excludedDocs.map((d) => d.externalId).filter(Boolean))

    if (externalDocs.length === 0 && existingDocs.length > 0 && !options?.fullSync) {
      logger.warn(
        `Source returned 0 documents but ${existingDocs.length} exist — skipping reconciliation`,
        { connectorId }
      )

      await db
        .update(knowledgeConnectorSyncLog)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(knowledgeConnectorSyncLog.id, syncLogId))

      const now = new Date()
      const nextSync =
        connector.syncIntervalMinutes > 0
          ? new Date(now.getTime() + connector.syncIntervalMinutes * 60 * 1000)
          : null

      await db
        .update(knowledgeConnector)
        .set({
          status: 'active',
          lastSyncAt: now,
          lastSyncError: null,
          nextSyncAt: nextSync,
          consecutiveFailures: 0,
          updatedAt: now,
        })
        .where(eq(knowledgeConnector.id, connectorId))

      return result
    }

    const existingByExternalId = new Map(
      existingDocs.filter((d) => d.externalId !== null).map((d) => [d.externalId!, d])
    )

    const seenExternalIds = new Set<string>()

    for (const extDoc of externalDocs) {
      seenExternalIds.add(extDoc.externalId)

      if (excludedExternalIds.has(extDoc.externalId)) {
        result.docsUnchanged++
        continue
      }

      if (!extDoc.content.trim()) {
        logger.info(`Skipping empty document: ${extDoc.title}`, {
          externalId: extDoc.externalId,
        })
        continue
      }

      const existing = existingByExternalId.get(extDoc.externalId)

      if (!existing) {
        await addDocument(
          connector.knowledgeBaseId,
          connectorId,
          connector.connectorType,
          extDoc,
          sourceConfig
        )
        result.docsAdded++
      } else if (existing.contentHash !== extDoc.contentHash) {
        await updateDocument(
          existing.id,
          connector.knowledgeBaseId,
          connectorId,
          connector.connectorType,
          extDoc,
          sourceConfig
        )
        result.docsUpdated++
      } else {
        result.docsUnchanged++
      }
    }

    if (options?.fullSync || connector.syncMode === 'incremental') {
      for (const existing of existingDocs) {
        if (existing.externalId && !seenExternalIds.has(existing.externalId)) {
          await db
            .update(document)
            .set({ deletedAt: new Date() })
            .where(eq(document.id, existing.id))
          result.docsDeleted++
        }
      }
    }

    await db
      .update(knowledgeConnectorSyncLog)
      .set({
        status: 'completed',
        completedAt: new Date(),
        docsAdded: result.docsAdded,
        docsUpdated: result.docsUpdated,
        docsDeleted: result.docsDeleted,
        docsUnchanged: result.docsUnchanged,
      })
      .where(eq(knowledgeConnectorSyncLog.id, syncLogId))

    const now = new Date()
    const nextSync =
      connector.syncIntervalMinutes > 0
        ? new Date(now.getTime() + connector.syncIntervalMinutes * 60 * 1000)
        : null

    await db
      .update(knowledgeConnector)
      .set({
        status: 'active',
        lastSyncAt: now,
        lastSyncError: null,
        lastSyncDocCount: externalDocs.length,
        nextSyncAt: nextSync,
        consecutiveFailures: 0,
        updatedAt: now,
      })
      .where(eq(knowledgeConnector.id, connectorId))

    logger.info('Sync completed', { connectorId, ...result })
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await db
      .update(knowledgeConnectorSyncLog)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage,
        docsAdded: result.docsAdded,
        docsUpdated: result.docsUpdated,
        docsDeleted: result.docsDeleted,
        docsUnchanged: result.docsUnchanged,
      })
      .where(eq(knowledgeConnectorSyncLog.id, syncLogId))

    const now = new Date()
    const failures = (connector.consecutiveFailures ?? 0) + 1
    const backoffMinutes = Math.min(failures * 30, 1440)
    const nextSync = new Date(now.getTime() + backoffMinutes * 60 * 1000)

    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        lastSyncAt: now,
        lastSyncError: errorMessage,
        nextSyncAt: nextSync,
        consecutiveFailures: failures,
        updatedAt: now,
      })
      .where(eq(knowledgeConnector.id, connectorId))

    logger.error('Sync failed', { connectorId, error: errorMessage })
    result.error = errorMessage
    return result
  }
}

/**
 * Upload content to storage as a .txt file, create a document record,
 * and trigger processing via the existing pipeline.
 */
async function addDocument(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  sourceConfig?: Record<string, unknown>
): Promise<void> {
  const documentId = crypto.randomUUID()
  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = extDoc.title.replace(/[^a-zA-Z0-9.-]/g, '_')
  const customKey = `kb/${Date.now()}-${documentId}-${safeTitle}.txt`

  const fileInfo = await StorageService.uploadFile({
    file: contentBuffer,
    fileName: `${safeTitle}.txt`,
    contentType: 'text/plain',
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  const displayName = extDoc.title
  const processingFilename = `${safeTitle}.txt`

  await db.insert(document).values({
    id: documentId,
    knowledgeBaseId,
    filename: displayName,
    fileUrl,
    fileSize: contentBuffer.length,
    mimeType: 'text/plain',
    chunkCount: 0,
    tokenCount: 0,
    characterCount: 0,
    processingStatus: 'pending',
    enabled: true,
    connectorId,
    externalId: extDoc.externalId,
    contentHash: extDoc.contentHash,
    sourceUrl: extDoc.sourceUrl ?? null,
    ...tagValues,
    uploadedAt: new Date(),
  })

  processDocumentAsync(
    knowledgeBaseId,
    documentId,
    {
      filename: processingFilename,
      fileUrl,
      fileSize: contentBuffer.length,
      mimeType: 'text/plain',
    },
    {}
  ).catch((error) => {
    logger.error('Failed to process connector document', {
      documentId,
      connectorId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

/**
 * Update an existing connector-sourced document with new content.
 * Updates in-place to avoid unique constraint violations on (connectorId, externalId).
 */
async function updateDocument(
  existingDocId: string,
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  sourceConfig?: Record<string, unknown>
): Promise<void> {
  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = extDoc.title.replace(/[^a-zA-Z0-9.-]/g, '_')
  const customKey = `kb/${Date.now()}-${existingDocId}-${safeTitle}.txt`

  const fileInfo = await StorageService.uploadFile({
    file: contentBuffer,
    fileName: `${safeTitle}.txt`,
    contentType: 'text/plain',
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  const processingFilename = `${safeTitle}.txt`

  await db
    .update(document)
    .set({
      filename: extDoc.title,
      fileUrl,
      fileSize: contentBuffer.length,
      contentHash: extDoc.contentHash,
      sourceUrl: extDoc.sourceUrl ?? null,
      ...tagValues,
      processingStatus: 'pending',
      uploadedAt: new Date(),
    })
    .where(eq(document.id, existingDocId))

  processDocumentAsync(
    knowledgeBaseId,
    existingDocId,
    {
      filename: processingFilename,
      fileUrl,
      fileSize: contentBuffer.length,
      mimeType: 'text/plain',
    },
    {}
  ).catch((error) => {
    logger.error('Failed to re-process updated connector document', {
      documentId: existingDocId,
      connectorId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
