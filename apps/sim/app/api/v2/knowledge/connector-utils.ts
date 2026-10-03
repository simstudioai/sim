import {
  type V2KnowledgeConnector,
  type V2KnowledgeConnectorDetail,
  type V2KnowledgeConnectorDocument,
  v2KnowledgeConnectorDetailSchema,
  v2KnowledgeConnectorDocumentSchema,
  v2KnowledgeConnectorSchema,
  v2KnowledgeConnectorSyncLogSchema,
} from '@/lib/api/contracts/v2/knowledge'

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function serializeNullableDate(value: Date | string | null): string | null {
  return value === null ? null : serializeDate(value)
}

interface KnowledgeConnectorProjection {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string | null
  sourceConfig: unknown
  syncMode: string | null
  syncIntervalMinutes: number
  status: string
  lastSyncAt: Date | string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: Date | string | null
  consecutiveFailures: number
  createdAt: Date | string
  updatedAt: Date | string
}

interface KnowledgeConnectorSyncLogProjection {
  id: string
  connectorId: string
  status: string
  startedAt: Date | string
  completedAt: Date | string | null
  docsAdded: number
  docsUpdated: number
  docsDeleted: number
  docsUnchanged: number
  docsSkipped: number
  docsFailed: number
  errorMessage: string | null
}

interface KnowledgeConnectorDocumentProjection {
  id: string
  filename: string
  externalId: string | null
  sourceUrl: string | null
  enabled: boolean
  userExcluded: boolean
  uploadedAt: Date | string
  processingStatus: string
}

export function toV2KnowledgeConnector(
  connector: KnowledgeConnectorProjection
): V2KnowledgeConnector {
  return v2KnowledgeConnectorSchema.parse({
    id: connector.id,
    knowledgeBaseId: connector.knowledgeBaseId,
    connectorType: connector.connectorType,
    credentialId: connector.credentialId,
    sourceConfig: connector.sourceConfig,
    syncMode: connector.syncMode,
    syncIntervalMinutes: connector.syncIntervalMinutes,
    status: connector.status,
    lastSyncAt: serializeNullableDate(connector.lastSyncAt),
    lastSyncError: connector.lastSyncError,
    lastSyncDocCount: connector.lastSyncDocCount,
    nextSyncAt: serializeNullableDate(connector.nextSyncAt),
    consecutiveFailures: connector.consecutiveFailures,
    createdAt: serializeDate(connector.createdAt),
    updatedAt: serializeDate(connector.updatedAt),
  })
}

export function toV2KnowledgeConnectorDetail(
  connector: KnowledgeConnectorProjection & { syncLogs: KnowledgeConnectorSyncLogProjection[] }
): V2KnowledgeConnectorDetail {
  return v2KnowledgeConnectorDetailSchema.parse({
    ...toV2KnowledgeConnector(connector),
    syncLogs: connector.syncLogs.map((log) =>
      v2KnowledgeConnectorSyncLogSchema.parse({
        id: log.id,
        connectorId: log.connectorId,
        status: log.status,
        startedAt: serializeDate(log.startedAt),
        completedAt: serializeNullableDate(log.completedAt),
        docsAdded: log.docsAdded,
        docsUpdated: log.docsUpdated,
        docsDeleted: log.docsDeleted,
        docsUnchanged: log.docsUnchanged,
        docsSkipped: log.docsSkipped,
        docsFailed: log.docsFailed,
        errorMessage: log.errorMessage,
      })
    ),
  })
}

export function toV2KnowledgeConnectorDocument(
  document: KnowledgeConnectorDocumentProjection
): V2KnowledgeConnectorDocument {
  return v2KnowledgeConnectorDocumentSchema.parse({
    id: document.id,
    filename: document.filename,
    externalId: document.externalId,
    sourceUrl: document.sourceUrl,
    enabled: document.enabled,
    userExcluded: document.userExcluded,
    createdAt: serializeDate(document.uploadedAt),
    processingStatus: document.processingStatus,
  })
}
