import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  knowledgeConnectorParamsSchema,
  successResponseSchema,
} from '@/lib/api/contracts/knowledge/shared'
import {
  booleanQueryFlagSchema,
  resourceOwnerSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { CONNECTOR_ACCESS_MODES } from '@/lib/knowledge/connectors/access-modes'
import {
  DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
} from '@/lib/knowledge/constants'
import { MEMBER_SYNC_STATUSES } from '@/lib/knowledge/types'

/**
 * How a connector derives document access.
 *
 * `workspace` syncs as one credential and every document is visible to the
 * whole workspace. `members` crawls once per Credential Group member, and a
 * document is visible to the members whose own crawl returned it. `admin`
 * crawls once under an administrative credential and mirrors the source's own
 * permissions onto each document.
 */
export const connectorAccessModeSchema = z.enum(CONNECTOR_ACCESS_MODES)
export type ConnectorAccessMode = z.output<typeof connectorAccessModeSchema>

/** The modes a caller may put a connector into. */
export const connectorRequestedAccessModeSchema = connectorAccessModeSchema

export const createConnectorBodySchema = z.object({
  connectorType: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  sourceConfig: z.record(z.string(), z.unknown()),
  syncIntervalMinutes: z.number().int().min(0).default(1440),
  accessMode: connectorRequestedAccessModeSchema.optional().default('workspace'),
})

export const updateConnectorAccessBodySchema = z.object({
  accessMode: connectorRequestedAccessModeSchema,
  /** Null removes dedicated content ingestion; omission preserves it in members mode. */
  credentialId: z.string().min(1).nullable().optional(),
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

export const VIEWER_CONNECTOR_MEMBERSHIPS = [
  'connected',
  'needs_reauth',
  'invited',
  'not_enrolled',
  'revoked',
  'unverified_email',
] as const
export const viewerConnectorMembershipSchema = z.enum(VIEWER_CONNECTOR_MEMBERSHIPS)
export type ViewerConnectorMembership = z.output<typeof viewerConnectorMembershipSchema>

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
    /**
     * Where the viewer stands with a per-member connector; null for a
     * workspace-mode connector, a caller with no person behind it, or where
     * per-member access is not available.
     */
    viewerMembership: viewerConnectorMembershipSchema.nullable(),
    credentialGroupId: z.string().nullable(),
    credentialGroupOptionId: z.string().nullable(),
    /** Members mode only; `idle` otherwise. */
    memberSyncStatus: z.enum(MEMBER_SYNC_STATUSES),
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
 * insert, then `completed`, `partial`, or `failed` on exit. Deliberately an
 * enum rather than a free string — a connector's own `status` values
 * (`syncing`, `error`, …) are a different vocabulary, and typing this as
 * `z.string()` is what let the UI branch on literals no producer ever wrote.
 */
export const syncLogStatusSchema = z.enum(['started', 'completed', 'partial', 'failed'])
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

export const startKnowledgeConnectorMemberEnrollmentDataSchema = z.object({
  /** The viewer's enrollment link; opening it connects their account. */
  url: z.string().url(),
})
export type StartKnowledgeConnectorMemberEnrollmentData = z.output<
  typeof startKnowledgeConnectorMemberEnrollmentDataSchema
>

export const startKnowledgeConnectorMemberEnrollmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors/[connectorId]/enroll',
  params: knowledgeConnectorParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(startKnowledgeConnectorMemberEnrollmentDataSchema),
  },
})

/** A source's personal account or mirrored-ACL identity connection for the current viewer. */
export const workspaceMemberConnectorSchema = z.object({
  knowledgeBaseId: z.string(),
  knowledgeBaseName: z.string(),
  knowledgeBaseIsSearchIndex: z.boolean().optional(),
  sourceDescription: z.string().max(240).optional(),
  connectorId: z.string(),
  connectorType: z.string(),
  memberSyncStatus: z.enum(MEMBER_SYNC_STATUSES),
  viewerMembership: viewerConnectorMembershipSchema,
  /** Documents of this connector the viewer may read right now. */
  viewerDocumentCount: z.number().int().nonnegative(),
})
export type WorkspaceMemberConnector = z.output<typeof workspaceMemberConnectorSchema>

const searchSourceSummaryFields = {
  knowledgeBaseId: knowledgeBaseParamsSchema.shape.id,
  connectorId: knowledgeConnectorParamsSchema.shape.connectorId,
  connectorType: z.string().min(1).max(100),
  sourceDescription: z.string().max(240),
  accessMode: z.enum(['admin', 'members']),
  availability: z.enum(['available', 'unavailable']),
  enabled: z.boolean(),
  approved: z.boolean().optional(),
  isSyncing: z.boolean(),
  lastSyncAt: z.string().datetime().nullable(),
  hasSyncError: z.boolean(),
  viewerDocumentCount: z.number().int().nonnegative(),
  viewerEmailVerified: z.boolean(),
}

export const searchSourceSummarySchema = z.discriminatedUnion('connectionRequired', [
  z.object({
    ...searchSourceSummaryFields,
    connectionRequired: z.literal(true),
    viewerMembership: viewerConnectorMembershipSchema.nullable(),
  }),
  z.object({
    ...searchSourceSummaryFields,
    connectionRequired: z.literal(false),
    viewerMembership: z.null(),
  }),
])
export type SearchSourceSummary = z.output<typeof searchSourceSummarySchema>

export const listSearchSourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/sources',
  query: resourceOwnerSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(searchSourceSummarySchema)),
  },
})

export const connectSimSearchConnectorBodySchema = resourceOwnerSchema.safeExtend({
  connectorType: z.string().min(1, 'connectorType cannot be empty').max(100),
  connectorId: knowledgeConnectorParamsSchema.shape.connectorId.max(255).optional(),
  /** Settings identify a compatible source, or assert the configuration of a selected source. */
  sourceConfig: z.record(z.string(), z.string().max(500)).optional(),
})
export type ConnectSimSearchConnectorBody = z.input<typeof connectSimSearchConnectorBodySchema>

export const prepareSearchSourceBodySchema = resourceOwnerSchema.safeExtend({
  connectorType: z.string().min(1, 'connectorType cannot be empty').max(100),
  accessMode: z.enum(['admin', 'members']).optional().default('admin'),
})
export type PrepareSearchSourceBody = z.input<typeof prepareSearchSourceBodySchema>

export const prepareSearchSourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/sim-search/prepare',
  body: prepareSearchSourceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({
        knowledgeBaseId: z.string().uuid(),
        credentialGroupId: z.string().uuid().optional(),
      }),
    }),
  },
})

/**
 * One click on a Sim Search source: the workspace's Sim Search knowledge base
 * and per-member connector exist afterwards, and the caller gets the link that
 * connects their own account.
 */
export const connectSimSearchConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/sim-search/connect',
  body: connectSimSearchConnectorBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({
        knowledgeBaseId: z.string(),
        connectorId: z.string(),
        url: z.string().url(),
      }),
    }),
  },
})

export const listWorkspaceMemberConnectorsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/member-connectors',
  query: z.object({ workspaceId: workspaceIdSchema }),
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(workspaceMemberConnectorSchema)),
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

export const readSearchIndexContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/index',
  query: resourceOwnerSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({ knowledgeBaseId: z.string().nullable() }),
    }),
  },
})
