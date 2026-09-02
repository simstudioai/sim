import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  knowledgeConnectorParamsSchema,
  successResponseSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
} from '@/lib/knowledge/constants'

/**
 * How a connector derives document access. `workspace` syncs as one credential
 * and every document is visible to the workspace; `members` crawls once per
 * Credential Group member and a document is visible to the members whose crawl
 * returned it. `admin` is reserved.
 */
export const connectorAccessModeSchema = z.enum(['workspace', 'members', 'admin'])
export type ConnectorAccessMode = z.output<typeof connectorAccessModeSchema>

/** The modes a caller may put a connector into. */
export const connectorRequestedAccessModeSchema = z.enum(['workspace', 'members'])

const connectorAccessBindingShape = {
  accessMode: connectorRequestedAccessModeSchema.optional().default('workspace'),
  /** Members mode: the Credential Group whose option supplies member credentials. */
  credentialGroupId: z.string().min(1).optional(),
  /** Members mode: the option within the group; must collect this connector's provider. */
  credentialGroupOptionId: z.string().min(1).optional(),
} as const

function requireAccessBinding(
  value: {
    accessMode: 'workspace' | 'members'
    credentialGroupId?: string
    credentialGroupOptionId?: string
  },
  ctx: z.RefinementCtx
): void {
  if (value.accessMode === 'members') {
    if (!value.credentialGroupId) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentialGroupId'],
        message: 'credentialGroupId is required when accessMode is members',
      })
    }
    if (!value.credentialGroupOptionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentialGroupOptionId'],
        message: 'credentialGroupOptionId is required when accessMode is members',
      })
    }
    return
  }
  if (value.credentialGroupId || value.credentialGroupOptionId) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentialGroupId'],
      message: 'A Credential Group binding only applies when accessMode is members',
    })
  }
}

export const createConnectorBodySchema = z
  .object({
    connectorType: z.string().min(1),
    credentialId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    sourceConfig: z.record(z.string(), z.unknown()),
    syncIntervalMinutes: z.number().int().min(0).default(1440),
    ...connectorAccessBindingShape,
  })
  .superRefine((value, ctx) => {
    requireAccessBinding(value, ctx)
    if (value.accessMode === 'members' && value.credentialId) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentialId'],
        message: 'A members-mode connector crawls with member credentials, not a credentialId',
      })
    }
  })

/**
 * Moves a connector between access modes. Switching to workspace mode needs
 * the credential the connector will sync as from then on.
 */
export const updateConnectorAccessBodySchema = z
  .object({
    ...connectorAccessBindingShape,
    credentialId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    requireAccessBinding(value, ctx)
    if (value.accessMode === 'members' && value.credentialId) {
      ctx.addIssue({
        code: 'custom',
        path: ['credentialId'],
        message: 'A members-mode connector crawls with member credentials, not a credentialId',
      })
    }
  })
export type UpdateConnectorAccessBody = z.input<typeof updateConnectorAccessBodySchema>

export const updateConnectorBodySchema = z.object({
  sourceConfig: z.record(z.string(), z.unknown()).optional(),
  syncIntervalMinutes: z.number().int().min(0).optional(),
  status: z.enum(['active', 'paused']).optional(),
})

export const deleteConnectorQuerySchema = z.object({
  /** Also hard-delete the documents the connector produced; kept by default. */
  deleteDocuments: booleanQueryFlagSchema.optional().default(false),
})

export const connectorDocumentsQuerySchema = z.object({
  includeExcluded: booleanQueryFlagSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE)
    .optional()
    .default(DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

export const connectorDocumentsPatchBodySchema = z.object({
  operation: z.enum(['restore', 'exclude']),
  documentIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS),
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
    /** `pending` means a sync is queued but no worker has taken the lock yet. */
    status: z.enum(['active', 'paused', 'pending', 'syncing', 'error', 'disabled']),
    lastSyncAt: z.string().nullable(),
    lastSyncError: z.string().nullable(),
    lastSyncDocCount: z.number().nullable(),
    nextSyncAt: z.string().nullable(),
    consecutiveFailures: z.number(),
    accessMode: connectorAccessModeSchema,
    credentialGroupId: z.string().nullable(),
    credentialGroupOptionId: z.string().nullable(),
    /** Members mode only; `idle` otherwise. */
    memberSyncStatus: z.enum(['idle', 'pending', 'running', 'error', 'disabled']),
    lastMemberSyncAt: z.string().nullable(),
    nextMemberSyncAt: z.string().nullable(),
    lastMemberSyncError: z.string().nullable(),
    memberSyncConsecutiveFailures: z.number(),
    /** A mode switch left its ACL rewrite for the next member run to finish. */
    accessRewritePending: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()
export type ConnectorData = z.output<typeof connectorDataSchema>

/**
 * The complete set of sync-log statuses the sync engine writes: `started` on
 * insert, then exactly one of `completed` / `failed` on exit. Deliberately an
 * enum rather than a free string — a connector's own `status` values
 * (`syncing`, `error`, …) are a different vocabulary, and typing this as
 * `z.string()` is what let the UI branch on literals no producer ever wrote.
 */
export const syncLogStatusSchema = z.enum(['started', 'completed', 'failed'])
export type SyncLogStatus = z.output<typeof syncLogStatusSchema>

export const syncLogDataSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    status: syncLogStatusSchema,
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    docsAdded: z.number(),
    docsUpdated: z.number(),
    docsDeleted: z.number(),
    docsUnchanged: z.number(),
    docsSkipped: z.number().int().nonnegative().default(0),
    docsFailed: z.number(),
    errorMessage: z.string().nullable(),
  })
  .passthrough()
export type SyncLogData = z.output<typeof syncLogDataSchema>

export const memberSyncLogDataSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    status: syncLogStatusSchema,
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    membersClaimed: z.number(),
    membersCompleted: z.number(),
    membersIncomplete: z.number(),
    membersFailed: z.number(),
    docsListed: z.number(),
    docsAdded: z.number(),
    docsUpdated: z.number(),
    docsUnchanged: z.number(),
    docsHydratedOnce: z.number(),
    observationsAdded: z.number(),
    observationsRemoved: z.number(),
    docsTombstoned: z.number(),
    docsResurrected: z.number(),
    docsPurged: z.number(),
    credentialsAudited: z.number(),
    errorMessage: z.string().nullable(),
  })
  .passthrough()
export type MemberSyncLogData = z.output<typeof memberSyncLogDataSchema>

/** How many of a members-mode connector's members are in each state. */
export const connectorMemberSummarySchema = z.object({
  active: z.number().int().nonnegative(),
  suspended: z.number().int().nonnegative(),
  /** Active members whose last complete listing is older than the staleness window. */
  stale: z.number().int().nonnegative(),
})
export type ConnectorMemberSummary = z.output<typeof connectorMemberSummarySchema>

export const connectorDetailDataSchema = connectorDataSchema.extend({
  syncLogs: z.array(syncLogDataSchema),
  memberSyncLogs: z.array(memberSyncLogDataSchema),
  members: connectorMemberSummarySchema,
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
    status: 201,
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

export const updateKnowledgeConnectorAccessContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/connectors/[connectorId]/access',
  params: knowledgeConnectorParamsSchema,
  body: updateConnectorAccessBodySchema,
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

export const triggerKnowledgeConnectorSyncQuerySchema = z.object({
  /**
   * Force re-hydration: for connectors whose rendered content can drift without a
   * hash change (e.g. Confluence transclusions), do a full listing and re-fetch +
   * re-index every already-synced document rather than only hash-changed ones. The
   * deletion-reconciliation safety guards stay armed. Defaults to the normal
   * hash-gated sync.
   */
  rehydrate: booleanQueryFlagSchema.optional().default(false),
})

export const triggerKnowledgeConnectorSyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors/[connectorId]/sync',
  params: knowledgeConnectorParamsSchema,
  query: triggerKnowledgeConnectorSyncQuerySchema,
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
