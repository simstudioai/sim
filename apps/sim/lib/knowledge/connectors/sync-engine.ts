import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import {
  hardDeleteDocuments,
  isTriggerAvailable,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { knowledgeConnectorSync } from '@/background/knowledge-connector-sync'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type {
  ConnectorAuthConfig,
  DocumentTags,
  ExternalDocument,
  SyncResult,
} from '@/connectors/types'

const logger = createLogger('ConnectorSyncEngine')

class ConnectorDeletedException extends Error {
  constructor(connectorId: string) {
    super(`Connector ${connectorId} was deleted during sync`)
    this.name = 'ConnectorDeletedException'
  }
}

const SYNC_BATCH_SIZE = 5
const MAX_PAGES = 500
const MAX_SAFE_TITLE_LENGTH = 200

/** Sanitizes a document title for use in S3 storage keys. */
function sanitizeStorageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, MAX_SAFE_TITLE_LENGTH)
}
type KnowledgeBaseLockingTx = Pick<typeof db, 'execute' | 'select'>

type DocOp =
  | { type: 'add'; extDoc: ExternalDocument }
  | { type: 'update'; existingId: string; extDoc: ExternalDocument }

async function isConnectorDeleted(connectorId: string): Promise<boolean> {
  const rows = await db
    .select({ archivedAt: knowledgeConnector.archivedAt, deletedAt: knowledgeConnector.deletedAt })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, connectorId))
    .limit(1)
  return rows.length === 0 || rows[0].archivedAt !== null || rows[0].deletedAt !== null
}

async function isKnowledgeBaseDeleted(knowledgeBaseId: string): Promise<boolean> {
  const rows = await db
    .select({ deletedAt: knowledgeBase.deletedAt })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)
  return rows.length === 0 || rows[0].deletedAt !== null
}

async function isKnowledgeBaseActiveInTx(
  tx: KnowledgeBaseLockingTx,
  knowledgeBaseId: string
): Promise<boolean> {
  await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

  const rows = await tx
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  return rows.length > 0
}

function calculateNextSyncTime(syncIntervalMinutes: number): Date | null {
  if (syncIntervalMinutes <= 0) return null
  const now = Date.now()
  const jitterMs = Math.floor(Math.random() * Math.min(syncIntervalMinutes * 6_000, 300_000))
  return new Date(now + syncIntervalMinutes * 60_000 + jitterMs)
}

async function completeSyncLog(
  syncLogId: string,
  status: 'completed' | 'failed',
  result: SyncResult,
  errorMessage?: string
): Promise<void> {
  await db
    .update(knowledgeConnectorSyncLog)
    .set({
      status,
      completedAt: new Date(),
      ...(errorMessage != null && { errorMessage }),
      docsAdded: result.docsAdded,
      docsUpdated: result.docsUpdated,
      docsDeleted: result.docsDeleted,
      docsUnchanged: result.docsUnchanged,
      docsFailed: result.docsFailed,
    })
    .where(eq(knowledgeConnectorSyncLog.id, syncLogId))
}

/**
 * Resolves tag values from connector metadata using the connector's mapTags function.
 * Translates semantic keys returned by mapTags to actual DB slots using the
 * tagSlotMapping stored in sourceConfig during connector creation.
 */
export function resolveTagMapping(
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
 * Resolves an access token for a connector based on its auth mode.
 * OAuth connectors refresh via the credential system; API key connectors
 * decrypt the key stored in the dedicated `encryptedApiKey` column.
 */
async function resolveAccessToken(
  connector: { credentialId: string | null; encryptedApiKey: string | null },
  connectorConfig: { auth: ConnectorAuthConfig },
  userId: string
): Promise<string | null> {
  if (connectorConfig.auth.mode === 'apiKey') {
    if (!connector.encryptedApiKey) {
      throw new Error('API key connector is missing encrypted API key')
    }
    const { decrypted } = await decryptApiKey(connector.encryptedApiKey)
    return decrypted
  }

  if (!connector.credentialId) {
    throw new Error('OAuth connector is missing credential ID')
  }

  return refreshAccessTokenIfNeeded(
    connector.credentialId,
    userId,
    `sync-${connector.credentialId}`
  )
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
    docsFailed: 0,
  }

  const connectorRows = await db
    .select()
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
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
    .where(and(eq(knowledgeBase.id, connector.knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kbRows.length === 0) {
    throw new Error(`Knowledge base not found: ${connector.knowledgeBaseId}`)
  }

  const userId = kbRows[0].userId
  const sourceConfig = connector.sourceConfig as Record<string, unknown>

  let accessToken = await resolveAccessToken(connector, connectorConfig, userId)

  if (!accessToken) {
    throw new Error('Failed to obtain access token')
  }

  const lockResult = await db
    .update(knowledgeConnector)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        ne(knowledgeConnector.status, 'syncing'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
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

  let syncExitedCleanly = false

  try {
    const externalDocs: ExternalDocument[] = []
    let cursor: string | undefined
    let hasMore = true
    const syncContext: Record<string, unknown> = {}

    // Determine if this sync should be incremental
    const isIncremental =
      connectorConfig.supportsIncrementalSync &&
      connector.syncMode !== 'full' &&
      !options?.fullSync &&
      connector.lastSyncAt != null
    const lastSyncAt =
      isIncremental && connector.lastSyncAt ? new Date(connector.lastSyncAt) : undefined

    for (let pageNum = 0; hasMore && pageNum < MAX_PAGES; pageNum++) {
      if (pageNum > 0 && connectorConfig.auth.mode === 'oauth') {
        const refreshed = await resolveAccessToken(connector, connectorConfig, userId)
        if (refreshed) accessToken = refreshed
      }

      const page = await connectorConfig.listDocuments(
        accessToken,
        sourceConfig,
        cursor,
        syncContext,
        lastSyncAt
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

    const [existingDocs, excludedDocs] = await Promise.all([
      db
        .select({
          id: document.id,
          externalId: document.externalId,
          contentHash: document.contentHash,
        })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        ),
      db
        .select({ externalId: document.externalId })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            eq(document.userExcluded, true),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        ),
    ])

    const excludedExternalIds = new Set(excludedDocs.map((d) => d.externalId).filter(Boolean))

    if (externalDocs.length === 0 && existingDocs.length > 0 && !options?.fullSync) {
      logger.warn(
        `Source returned 0 documents but ${existingDocs.length} exist — skipping reconciliation`,
        { connectorId }
      )

      await completeSyncLog(syncLogId, 'completed', result)

      const now = new Date()
      await db
        .update(knowledgeConnector)
        .set({
          status: 'active',
          lastSyncAt: now,
          lastSyncError: null,
          nextSyncAt: calculateNextSyncTime(connector.syncIntervalMinutes),
          consecutiveFailures: 0,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )

      return result
    }

    const existingByExternalId = new Map(
      existingDocs.filter((d) => d.externalId !== null).map((d) => [d.externalId!, d])
    )

    const seenExternalIds = new Set<string>()

    const pendingOps: DocOp[] = []
    for (const extDoc of externalDocs) {
      seenExternalIds.add(extDoc.externalId)

      if (excludedExternalIds.has(extDoc.externalId)) {
        result.docsUnchanged++
        continue
      }

      if (!extDoc.content.trim() && !extDoc.contentDeferred) {
        logger.info(`Skipping empty document: ${extDoc.title}`, {
          externalId: extDoc.externalId,
        })
        continue
      }

      const existing = existingByExternalId.get(extDoc.externalId)

      if (!existing) {
        pendingOps.push({ type: 'add', extDoc })
      } else if (existing.contentHash !== extDoc.contentHash) {
        pendingOps.push({ type: 'update', existingId: existing.id, extDoc })
      } else {
        result.docsUnchanged++
      }
    }

    for (let i = 0; i < pendingOps.length; i += SYNC_BATCH_SIZE) {
      if (await isConnectorDeleted(connectorId)) {
        throw new ConnectorDeletedException(connectorId)
      }
      if (await isKnowledgeBaseDeleted(connector.knowledgeBaseId)) {
        throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
      }

      const rawBatch = pendingOps.slice(i, i + SYNC_BATCH_SIZE)

      const deferredOps = rawBatch.filter((op) => op.extDoc.contentDeferred)
      const readyOps = rawBatch.filter((op) => !op.extDoc.contentDeferred)

      if (deferredOps.length > 0) {
        if (connectorConfig.auth.mode === 'oauth') {
          const refreshed = await resolveAccessToken(connector, connectorConfig, userId)
          if (refreshed) accessToken = refreshed
        }

        const hydrated = await Promise.allSettled(
          deferredOps.map(async (op) => {
            const fullDoc = await connectorConfig.getDocument(
              accessToken!,
              sourceConfig,
              op.extDoc.externalId,
              syncContext
            )
            if (!fullDoc?.content.trim()) return null
            return {
              ...op,
              extDoc: {
                ...op.extDoc,
                content: fullDoc.content,
                contentHash: fullDoc.contentHash ?? op.extDoc.contentHash,
                contentDeferred: false,
              },
            }
          })
        )

        for (const outcome of hydrated) {
          if (outcome.status === 'fulfilled' && outcome.value) {
            readyOps.push(outcome.value)
          } else if (outcome.status === 'rejected') {
            result.docsFailed++
            logger.error('Failed to hydrate deferred document', {
              connectorId,
              error:
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            })
          }
        }
      }

      const batch = readyOps

      const settled = await Promise.allSettled(
        batch.map((op) => {
          if (op.type === 'add') {
            return addDocument(
              connector.knowledgeBaseId,
              connectorId,
              connector.connectorType,
              op.extDoc,
              sourceConfig
            )
          }
          return updateDocument(
            op.existingId,
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            op.extDoc,
            sourceConfig
          )
        })
      )

      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j]
        if (outcome.status === 'fulfilled') {
          if (batch[j].type === 'add') result.docsAdded++
          else result.docsUpdated++
        } else {
          result.docsFailed++
          logger.error('Failed to process document', {
            connectorId,
            externalId: batch[j].extDoc.externalId,
            error:
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          })
        }
      }
    }

    // Skip deletion reconciliation during incremental syncs — results only contain changed docs
    if (!isIncremental && (options?.fullSync || connector.syncMode === 'full')) {
      const removedIds = existingDocs
        .filter((d) => d.externalId && !seenExternalIds.has(d.externalId))
        .map((d) => d.id)

      if (removedIds.length > 0) {
        await hardDeleteDocuments(removedIds, syncLogId)
        result.docsDeleted += removedIds.length
      }
    }

    // Check if connector was deleted before retrying stuck documents
    if (await isConnectorDeleted(connectorId)) {
      throw new ConnectorDeletedException(connectorId)
    }
    if (await isKnowledgeBaseDeleted(connector.knowledgeBaseId)) {
      throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
    }

    // Retry stuck documents that failed or never completed processing
    const stuckDocs = await db
      .select({
        id: document.id,
        fileUrl: document.fileUrl,
        filename: document.filename,
        fileSize: document.fileSize,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          inArray(document.processingStatus, ['pending', 'failed']),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    if (stuckDocs.length > 0) {
      logger.info(`Retrying ${stuckDocs.length} stuck documents`, { connectorId })
      for (const doc of stuckDocs) {
        processDocumentAsync(
          connector.knowledgeBaseId,
          doc.id,
          {
            filename: doc.filename ?? 'document.txt',
            fileUrl: doc.fileUrl ?? '',
            fileSize: doc.fileSize ?? 0,
            mimeType: 'text/plain',
          },
          {}
        ).catch((error) => {
          logger.warn('Failed to retry stuck document', {
            documentId: doc.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }

    await completeSyncLog(syncLogId, 'completed', result)

    const now = new Date()
    await db
      .update(knowledgeConnector)
      .set({
        status: 'active',
        lastSyncAt: now,
        lastSyncError: null,
        lastSyncDocCount: externalDocs.length,
        nextSyncAt: calculateNextSyncTime(connector.syncIntervalMinutes),
        consecutiveFailures: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )

    logger.info('Sync completed', { connectorId, ...result })
    syncExitedCleanly = true
    return result
  } catch (error) {
    if (error instanceof ConnectorDeletedException) {
      logger.info('Connector deleted during sync, cleaning up', { connectorId })

      try {
        const connectorDocs = await db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.connectorId, connectorId),
              isNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )

        await hardDeleteDocuments(
          connectorDocs.map((doc) => doc.id),
          syncLogId
        )

        await completeSyncLog(syncLogId, 'failed', result, 'Connector deleted during sync')
      } catch (cleanupError) {
        logger.error('Failed to clean up after connector deletion', {
          connectorId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }

      result.error = 'Connector deleted during sync'
      syncExitedCleanly = true
      return result
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Sync failed', { connectorId, error: errorMessage })

    try {
      await completeSyncLog(syncLogId, 'failed', result, errorMessage)

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
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
    } catch (recoveryError) {
      logger.error('Failed to record sync failure', {
        connectorId,
        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      })
    }

    result.error = errorMessage
    syncExitedCleanly = true
    return result
  } finally {
    if (!syncExitedCleanly) {
      try {
        await db
          .update(knowledgeConnector)
          .set({
            status: 'error',
            lastSyncError: 'Sync terminated unexpectedly',
            updatedAt: new Date(),
          })
          .where(eq(knowledgeConnector.id, connectorId))
        logger.warn('Reset stale syncing status in finally block', { connectorId })
      } catch (finallyError) {
        logger.warn('Failed to reset syncing status in finally block', {
          connectorId,
          error: finallyError instanceof Error ? finallyError.message : String(finallyError),
        })
      }
    }
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
  if (await isKnowledgeBaseDeleted(knowledgeBaseId)) {
    throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
  }
  const documentId = crypto.randomUUID()
  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = sanitizeStorageTitle(extDoc.title)
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

  const processingFilename = `${safeTitle}.txt`

  try {
    await db.transaction(async (tx) => {
      const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
      if (!isActive) {
        throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
      }

      await tx.insert(document).values({
        id: documentId,
        knowledgeBaseId,
        filename: extDoc.title,
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
    })
  } catch (error) {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    if (storageKey && storageKey !== urlPath) {
      await deleteFile({ key: storageKey, context: 'knowledge-base' }).catch(() => undefined)
    }
    throw error
  }

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
  if (await isKnowledgeBaseDeleted(knowledgeBaseId)) {
    throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
  }
  // Fetch old file URL before uploading replacement
  const existingRows = await db
    .select({ fileUrl: document.fileUrl })
    .from(document)
    .where(eq(document.id, existingDocId))
    .limit(1)
  const oldFileUrl = existingRows[0]?.fileUrl

  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = sanitizeStorageTitle(extDoc.title)
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

  try {
    await db.transaction(async (tx) => {
      const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
      if (!isActive) {
        throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
      }

      await tx
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
        .where(
          and(
            eq(document.id, existingDocId),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
        .returning({ id: document.id })
        .then((rows) => {
          if (rows.length === 0) {
            throw new Error(`Document ${existingDocId} is no longer active`)
          }
        })
    })
  } catch (error) {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    if (storageKey && storageKey !== urlPath) {
      await deleteFile({ key: storageKey, context: 'knowledge-base' }).catch(() => undefined)
    }
    throw error
  }

  // Clean up old storage file
  if (oldFileUrl) {
    try {
      const urlPath = new URL(oldFileUrl, 'http://localhost').pathname
      const storageKey = extractStorageKey(urlPath)
      if (storageKey && storageKey !== urlPath) {
        await deleteFile({ key: storageKey, context: 'knowledge-base' })
      }
    } catch (error) {
      logger.warn('Failed to delete old storage file', {
        documentId: existingDocId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
