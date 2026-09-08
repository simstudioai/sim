import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  V2_WRITABLE_TAG_SLOTS,
  type V2UpdateKnowledgeDocumentBody,
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
  v2UpdateKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeDocument,
  readKnowledgeDocument,
  type UpdateKnowledgeDocumentInput,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import {
  toV2DocumentSummary,
  toV2DocumentTags,
  toV2TaggedDocument,
} from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type V2DocumentUpdates = Omit<V2UpdateKnowledgeDocumentBody, 'workspaceId' | 'retryProcessing'>

type UpdateKnowledgeDocumentUpdates = NonNullable<UpdateKnowledgeDocumentInput['updates']>

/**
 * Serializes the typed tag slots for the document writer.
 *
 * The wire takes each slot in its natural JSON type — a number for a number
 * slot, `true`/`false` for a boolean one — because that is how a document read
 * projects them. The writer's `convertTagValue` takes strings and parses back to
 * the storage column's type, so the boundary hands it the canonical spelling.
 * The contract has already rejected anything those parsers would answer `null`
 * for, so nothing reaches storage silently cleared.
 */
function toTagSlotUpdates(updates: V2DocumentUpdates): UpdateKnowledgeDocumentUpdates {
  const { filename, enabled, ...slots } = updates
  const serialized: Record<string, string> = {}
  for (const slot of V2_WRITABLE_TAG_SLOTS) {
    const value = slots[slot]
    if (value === undefined) continue
    serialized[slot] = typeof value === 'string' ? value : String(value)
  }
  return {
    ...(filename === undefined ? {} : { filename }),
    ...(enabled === undefined ? {} : { enabled }),
    ...serialized,
  }
}

/** GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId] — Get document details. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeDocument,
  present: ({ document, tagDefinitions }) => ({
    data: {
      ...toV2DocumentSummary(document),
      tags: toV2DocumentTags(document, tagDefinitions),
      processingError: document.processingError,
      processingStartedAt: serializeDate(document.processingStartedAt),
      processingCompletedAt: serializeDate(document.processingCompletedAt),
      connectorId: document.connectorId,
      connectorType: document.connectorType,
      sourceUrl: document.sourceUrl,
    },
  }),
})

/**
 * PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId] — Update a document.
 *
 * Renames, enables or disables, retags, or requeues processing. Derived
 * indexing state is not writable; the contract records why.
 *
 * The updated document is returned without connector provenance because the
 * update writes and returns the document row alone. A caller that needs the full
 * detail re-reads it with GET.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => {
    const { workspaceId, retryProcessing, ...updates } = body
    return {
      knowledgeBaseId: params.knowledgeBaseId,
      documentId: params.documentId,
      assertedWorkspaceId: workspaceId,
      ...(retryProcessing ? { retryProcessing } : { updates: toTagSlotUpdates(updates) }),
      source: 'api',
    }
  },
  useCase: updateKnowledgeDocument,
  present: (result) =>
    result.kind === 'processing'
      ? {
          data: {
            id: result.documentId,
            queued: true as const,
            processingStatus: result.status,
            message: result.message,
          },
        }
      : { data: toV2TaggedDocument(result.document, result.tagDefinitions) },
})

/** DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId] — Delete a document. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
    source: 'api',
  }),
  useCase: deleteKnowledgeDocument,
  onSuccess: ({ principal, input }) => {
    if (isUserCredentialPrincipal(principal)) {
      captureServerEvent(
        principal.userId,
        'knowledge_base_document_deleted',
        {
          knowledge_base_id: input.knowledgeBaseId,
          workspace_id: input.assertedWorkspaceId ?? '',
        },
        input.assertedWorkspaceId ? { groups: { workspace: input.assertedWorkspaceId } } : undefined
      )
    }
  },
  present: ({ id }) => ({ data: { id, deleted: true as const } }),
})
