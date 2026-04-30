import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  knowledgeConnectorParamsSchema,
  successResponseSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const createConnectorBodySchema = z.object({
  connectorType: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  sourceConfig: z.record(z.string(), z.unknown()),
  syncIntervalMinutes: z.number().int().min(0).default(1440),
})

export const updateConnectorBodySchema = z.object({
  sourceConfig: z.record(z.string(), z.unknown()).optional(),
  syncIntervalMinutes: z.number().int().min(0).optional(),
  status: z.enum(['active', 'paused']).optional(),
})

export const deleteConnectorQuerySchema = z.object({
  deleteDocuments: z.boolean().optional(),
})

export const connectorDocumentsQuerySchema = z.object({
  includeExcluded: z.boolean().optional(),
})

export const connectorDocumentsPatchBodySchema = z.object({
  operation: z.enum(['restore', 'exclude']),
  documentIds: z.array(z.string()).min(1),
})

export const connectorDataSchema = z
  .object({
    id: z.string(),
    knowledgeBaseId: z.string(),
    connectorType: z.string(),
    credentialId: z.string().nullable(),
    sourceConfig: z.record(z.string(), z.unknown()),
    syncMode: z.string().nullable(),
    syncIntervalMinutes: z.number(),
    status: z.enum(['active', 'paused', 'syncing', 'error', 'disabled']),
    lastSyncAt: z.string().nullable(),
    lastSyncError: z.string().nullable(),
    lastSyncDocCount: z.number().nullable(),
    nextSyncAt: z.string().nullable(),
    consecutiveFailures: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()
export type ConnectorData = z.output<typeof connectorDataSchema>

export const syncLogDataSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    status: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    docsAdded: z.number(),
    docsUpdated: z.number(),
    docsDeleted: z.number(),
    docsUnchanged: z.number(),
    docsFailed: z.number(),
    errorMessage: z.string().nullable(),
  })
  .passthrough()
export type SyncLogData = z.output<typeof syncLogDataSchema>

export const connectorDetailDataSchema = connectorDataSchema.extend({
  syncLogs: z.array(syncLogDataSchema),
})
export type ConnectorDetailData = z.output<typeof connectorDetailDataSchema>

export const connectorDocumentDataSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    externalId: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    enabled: z.boolean(),
    deletedAt: z.string().nullable().default(null),
    userExcluded: z.boolean(),
    uploadedAt: z.string(),
    processingStatus: z.string(),
  })
  .passthrough()
export type ConnectorDocumentData = z.output<typeof connectorDocumentDataSchema>

export const connectorDocumentsDataSchema = z.object({
  documents: z.array(connectorDocumentDataSchema),
  counts: z.object({ active: z.number(), excluded: z.number() }),
})
export type ConnectorDocumentsData = z.output<typeof connectorDocumentsDataSchema>

export const listKnowledgeConnectorsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(connectorDataSchema)),
  },
})

export const createKnowledgeConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors',
  params: knowledgeBaseParamsSchema,
  body: createConnectorBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDataSchema),
  },
})

export const getKnowledgeConnectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDetailDataSchema),
  },
})

export const updateKnowledgeConnectorContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  body: updateConnectorBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDataSchema),
  },
})

export const deleteKnowledgeConnectorContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  query: deleteConnectorQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const triggerKnowledgeConnectorSyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors/[connectorId]/sync',
  params: knowledgeConnectorParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      message: z.string(),
    }),
  },
})

export const listKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors/[connectorId]/documents',
  params: knowledgeConnectorParamsSchema,
  query: connectorDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDocumentsDataSchema),
  },
})

export const patchKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/connectors/[connectorId]/documents',
  params: knowledgeConnectorParamsSchema,
  body: connectorDocumentsPatchBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z
        .object({
          excludedCount: z.number().optional(),
          restoredCount: z.number().optional(),
          documentIds: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
  },
})
