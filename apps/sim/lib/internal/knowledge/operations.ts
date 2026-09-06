import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { z } from 'zod'
import {
  type createChunkBodySchema,
  type createKnowledgeDocumentsBodySchema,
  type listKnowledgeChunksQuerySchema,
  type listKnowledgeDocumentsQuerySchema,
  parseDocumentTagFiltersParam,
  type updateChunkBodySchema,
  type upsertDocumentBodySchema,
} from '@/lib/api/contracts/knowledge'
import type { KnowledgeSearchBody } from '@/lib/api/contracts/knowledge/search'
import { AuthType } from '@/lib/auth/hybrid'
import { requireWorkspaceBillingAttributionHeader } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAnalytics,
  internalKnowledgeProvenanceUserId,
  toInternalKnowledgeChunk,
  toInternalKnowledgeConnector,
  toInternalKnowledgeConnectorDetail,
  toInternalKnowledgeDocument,
  toInternalKnowledgeTag,
} from '@/lib/knowledge/api/internal-route'
import {
  finalizeKnowledgePersistedResponse,
  finalizeKnowledgeProvenanceResponse,
  finalizeKnowledgeRegistryResponse,
  resolveKnowledgeDocumentWriteSecretProvenance,
  resolveKnowledgeWriteSecretProvenance,
} from '@/lib/knowledge/api/secret-provenance'
import {
  createKnowledgeChunk,
  deleteKnowledgeChunk,
  listKnowledgeChunks,
  updateKnowledgeChunk,
} from '@/lib/knowledge/application/chunks'
import {
  listKnowledgeConnectors,
  readKnowledgeConnector,
  syncKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import {
  createKnowledgeDocuments,
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  readKnowledgeDocument,
  upsertKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { listKnowledgeTags } from '@/lib/knowledge/application/tags'
import { prepareKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'

export interface KnowledgeOperationContext {
  principal: WorkflowExecutionDelegatedPrincipal
  headers: Headers
  signal?: AbortSignal
}

export interface KnowledgeOperationResponse {
  body: Record<string, unknown>
  headers?: HeadersInit
  bodyFields?: Readonly<Record<string, unknown>>
}

type CreateDocumentsBody = z.output<typeof createKnowledgeDocumentsBodySchema>
type UpsertDocumentBody = z.output<typeof upsertDocumentBodySchema>
type CreateChunkBody = z.output<typeof createChunkBodySchema>
type UpdateChunkBody = z.output<typeof updateChunkBodySchema>
type ListDocumentsQuery = z.output<typeof listKnowledgeDocumentsQuerySchema>
type ListChunksQuery = z.output<typeof listKnowledgeChunksQuerySchema>

function throwIfAborted(context: KnowledgeOperationContext): void {
  context.signal?.throwIfAborted()
}

function billingAttribution(context: KnowledgeOperationContext, workspaceId: string) {
  return requireWorkspaceBillingAttributionHeader(context.headers, { workspaceId })
}

function resolveChunkContentProvenance(
  context: KnowledgeOperationContext,
  payload: unknown,
  workspaceId: string | undefined,
  includeContent: boolean
) {
  const resolved = resolveKnowledgeWriteSecretProvenance({
    headers: context.headers,
    payload,
    authType: AuthType.INTERNAL_JWT,
    userId: internalKnowledgeProvenanceUserId(context.headers, context.principal, workspaceId),
    ...(workspaceId ? { workspaceId } : {}),
    selectionKeys: includeContent ? ['chunk-content'] : [],
  })
  if (!resolved.success) {
    throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
  }
  return resolved.provenances?.[0]
}

export async function listDocumentsOperation(
  knowledgeBaseId: string,
  query: ListDocumentsQuery,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  let tagFilters
  try {
    tagFilters = parseDocumentTagFiltersParam(query.tagFilters)
  } catch {
    throw new OrchestrationError('validation', 'tagFilters must be a valid JSON array')
  }
  const result = await listKnowledgeDocuments.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      assertedWorkspaceId: context.principal.workspaceId,
      enabledFilter: query.enabledFilter,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      tagFilters,
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = {
    success: true,
    data: {
      documents: result.documents.map(toInternalKnowledgeDocument),
      pagination: result.pagination,
    },
  }
  const finalization = await finalizeKnowledgePersistedResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: internalKnowledgeProvenanceUserId(
      context.headers,
      context.principal,
      result.workspaceId
    ),
    workspaceId: result.workspaceId,
    body,
    documents: result.documents.map((document) => ({
      id: document.id,
      source: createKnowledgeDocumentSourceValue(document),
      value: document,
    })),
  })
  return { body, ...finalization }
}

export async function createDocumentsOperation(
  knowledgeBaseId: string,
  bodyInput: CreateDocumentsBody,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const documents = bodyInput.bulk ? bodyInput.documents : [bodyInput]
  const input = {
    knowledgeBaseId,
    assertedWorkspaceId: context.principal.workspaceId,
    documents,
    bulk: bodyInput.bulk,
    processingOptions: bodyInput.bulk ? bodyInput.processingOptions : undefined,
    resolveBillingAttribution: (workspaceId: string) =>
      Promise.resolve(billingAttribution(context, workspaceId)),
    resolveSecretProvenances: ({
      userId,
      workspaceId,
    }: {
      userId: string
      workspaceId?: string
    }) => {
      const resolved = resolveKnowledgeDocumentWriteSecretProvenance({
        headers: context.headers,
        payload: bodyInput,
        authType: AuthType.INTERNAL_JWT,
        userId,
        workspaceId,
        documents,
      })
      if (!resolved.success) {
        throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
      }
      return resolved.provenances
    },
    source: 'ui' as const,
  }
  const result = await createKnowledgeDocuments.execute({
    principal: context.principal,
    input,
    request: { headers: context.headers },
  })
  internalKnowledgeAnalytics.documentsUploaded({ principal: context.principal, input, result })
  throwIfAborted(context)
  const body = {
    success: true,
    data: result.kind === 'bulk' ? result.data : toInternalKnowledgeDocument(result.data),
  }
  const finalization = await finalizeKnowledgeProvenanceResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: result.userId,
    workspaceId: result.workspaceId,
    provenances:
      result.secretProvenances?.flatMap((provenance) => [
        provenance.filename,
        ...provenance.tags.map((tag) => tag.provenance),
      ]) ?? [],
    body,
  })
  return { body, ...finalization }
}

export async function readDocumentOperation(
  knowledgeBaseId: string,
  documentId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await readKnowledgeDocument.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      documentId,
      assertedWorkspaceId: context.principal.workspaceId,
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = { success: true, data: toInternalKnowledgeDocument(result.document) }
  const finalization = await finalizeKnowledgePersistedResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: internalKnowledgeProvenanceUserId(
      context.headers,
      context.principal,
      result.workspaceId
    ),
    workspaceId: result.workspaceId,
    body,
    documents: [
      {
        id: result.document.id,
        source: createKnowledgeDocumentSourceValue(result.document),
        value: result.document,
      },
    ],
  })
  return { body, ...finalization }
}

export async function deleteDocumentOperation(
  knowledgeBaseId: string,
  documentId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const input = {
    knowledgeBaseId,
    documentId,
    assertedWorkspaceId: context.principal.workspaceId,
    source: 'ui',
  }
  const result = await deleteKnowledgeDocument.execute({
    principal: context.principal,
    input,
    request: { headers: context.headers },
  })
  internalKnowledgeAnalytics.documentDeleted({ principal: context.principal, result })
  throwIfAborted(context)
  return {
    body: {
      success: true,
      data: { success: true, message: 'Document deleted successfully' },
    },
  }
}

export async function upsertDocumentOperation(
  knowledgeBaseId: string,
  bodyInput: UpsertDocumentBody,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const input = {
    knowledgeBaseId,
    assertedWorkspaceId: context.principal.workspaceId,
    documentId: bodyInput.documentId,
    filename: bodyInput.filename,
    fileUrl: bodyInput.fileUrl,
    fileSize: bodyInput.fileSize,
    mimeType: bodyInput.mimeType,
    documentTagsData: bodyInput.documentTagsData,
    processingOptions: bodyInput.processingOptions,
    resolveBillingAttribution: (workspaceId: string) =>
      Promise.resolve(billingAttribution(context, workspaceId)),
    resolveSecretProvenances: ({
      userId,
      workspaceId,
    }: {
      userId: string
      workspaceId?: string
    }) => {
      const resolved = resolveKnowledgeDocumentWriteSecretProvenance({
        headers: context.headers,
        payload: bodyInput,
        authType: AuthType.INTERNAL_JWT,
        userId,
        workspaceId,
        documents: [bodyInput],
      })
      if (!resolved.success) {
        throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
      }
      return resolved.provenances
    },
  }
  const result = await upsertKnowledgeDocument.execute({
    principal: context.principal,
    input,
    request: { headers: context.headers },
  })
  internalKnowledgeAnalytics.documentUpserted({ principal: context.principal, input, result })
  throwIfAborted(context)
  const body = {
    success: true,
    data: {
      documentsCreated: [
        {
          documentId: result.document.documentId,
          filename: result.document.filename,
          status: 'pending' as const,
        },
      ],
      isUpdate: result.isUpdate,
      previousDocumentId: result.previousDocumentId,
      processingMethod: 'background' as const,
      processingConfig: result.processingConfig,
    },
  }
  const finalization = await finalizeKnowledgeProvenanceResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: result.userId,
    workspaceId: result.workspaceId,
    body,
    provenances:
      result.secretProvenances?.flatMap((provenance) => [
        provenance.filename,
        ...provenance.tags.map((tag) => tag.provenance),
      ]) ?? [],
  })
  return { body, ...finalization }
}

export async function listChunksOperation(
  knowledgeBaseId: string,
  documentId: string,
  query: ListChunksQuery,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await listKnowledgeChunks.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      documentId,
      assertedWorkspaceId: context.principal.workspaceId,
      ...query,
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = {
    success: true,
    data: result.chunks.map(toInternalKnowledgeChunk),
    pagination: result.pagination,
  }
  const finalization = await finalizeKnowledgePersistedResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: internalKnowledgeProvenanceUserId(
      context.headers,
      context.principal,
      result.workspaceId
    ),
    workspaceId: result.workspaceId,
    body,
    chunks: result.chunks.map((chunk) => ({
      id: chunk.id,
      documentId: result.documentId,
      content: chunk.content,
      value: chunk,
    })),
  })
  return { body, ...finalization }
}

export async function createChunkOperation(
  knowledgeBaseId: string,
  documentId: string,
  bodyInput: CreateChunkBody,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await createKnowledgeChunk.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      documentId,
      assertedWorkspaceId: context.principal.workspaceId,
      content: bodyInput.content,
      enabled: bodyInput.enabled,
      resolveContentProvenance: ({ workspaceId }) =>
        resolveChunkContentProvenance(context, bodyInput, workspaceId, true),
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = { success: true, data: toInternalKnowledgeChunk(result.chunk) }
  const finalization = await finalizeKnowledgeProvenanceResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: result.userId,
    workspaceId: result.workspaceId,
    body,
    provenances: result.provenance ? [result.provenance] : [],
  })
  return { body, ...finalization }
}

export async function updateChunkOperation(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  bodyInput: UpdateChunkBody,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await updateKnowledgeChunk.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      documentId,
      chunkId,
      assertedWorkspaceId: context.principal.workspaceId,
      content: bodyInput.content,
      enabled: bodyInput.enabled,
      resolveContentProvenance: ({ workspaceId }) =>
        resolveChunkContentProvenance(
          context,
          bodyInput,
          workspaceId,
          bodyInput.content !== undefined
        ),
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = { success: true, data: toInternalKnowledgeChunk(result.chunk) }
  const finalization = await finalizeKnowledgePersistedResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    userId: internalKnowledgeProvenanceUserId(
      context.headers,
      context.principal,
      result.workspaceId
    ),
    workspaceId: result.workspaceId,
    body,
    chunks: [
      {
        id: result.chunk.id,
        documentId: result.documentId,
        content: result.chunk.content,
        value: result.chunk,
      },
    ],
  })
  return { body, ...finalization }
}

export async function deleteChunkOperation(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  await deleteKnowledgeChunk.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      documentId,
      chunkId,
      assertedWorkspaceId: context.principal.workspaceId,
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  return { body: { success: true, data: { message: 'Chunk deleted successfully' } } }
}

export async function listConnectorsOperation(
  knowledgeBaseId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await listKnowledgeConnectors.execute({
    principal: context.principal,
    input: { knowledgeBaseId, assertedWorkspaceId: context.principal.workspaceId },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  return {
    body: { success: true, data: result.connectors.map(toInternalKnowledgeConnector) },
  }
}

export async function readConnectorOperation(
  knowledgeBaseId: string,
  connectorId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await readKnowledgeConnector.execute({
    principal: context.principal,
    input: {
      knowledgeBaseId,
      connectorId,
      assertedWorkspaceId: context.principal.workspaceId,
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  return { body: { success: true, data: toInternalKnowledgeConnectorDetail(result.connector) } }
}

export async function syncConnectorOperation(
  knowledgeBaseId: string,
  connectorId: string,
  rehydrate: boolean,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const input = {
    knowledgeBaseId,
    connectorId,
    assertedWorkspaceId: context.principal.workspaceId,
    rehydrate,
    resolveBillingAttribution: (workspaceId: string) =>
      Promise.resolve(billingAttribution(context, workspaceId)),
    source: 'ui' as const,
  }
  const result = await syncKnowledgeConnector.execute({
    principal: context.principal,
    input,
    request: { headers: context.headers },
  })
  internalKnowledgeAnalytics.connectorSynced({ principal: context.principal, input, result })
  throwIfAborted(context)
  return { body: { success: true, message: 'Sync triggered' } }
}

export async function listTagsOperation(
  knowledgeBaseId: string,
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await listKnowledgeTags.execute({
    principal: context.principal,
    input: { knowledgeBaseId, assertedWorkspaceId: context.principal.workspaceId },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  return {
    body: { success: true, data: result.tagDefinitions.map(toInternalKnowledgeTag) },
  }
}

export async function searchOperation(
  bodyInput: KnowledgeSearchBody & { skipUsageBilling?: boolean },
  context: KnowledgeOperationContext
): Promise<KnowledgeOperationResponse> {
  throwIfAborted(context)
  const result = await searchKnowledge.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      knowledgeBaseIds: Array.isArray(bodyInput.knowledgeBaseIds)
        ? bodyInput.knowledgeBaseIds
        : [bodyInput.knowledgeBaseIds],
      query: bodyInput.query,
      topK: bodyInput.topK,
      surface: 'workflow',
      tagFilters: bodyInput.tagFilters,
      searchMode: bodyInput.searchMode,
      rerankerEnabled: bodyInput.rerankerEnabled,
      rerankerModel: bodyInput.rerankerModel,
      rerankerInputCount: bodyInput.rerankerInputCount,
      rerankerApiKey: bodyInput.rerankerApiKey,
      skipUsageBilling: bodyInput.skipUsageBilling,
      resolveBillingAttribution: (workspaceId: string) =>
        Promise.resolve(billingAttribution(context, workspaceId)),
      prepareModelInputProvenance: async ({ userId, workspaceId }) => {
        const prepared = await prepareKnowledgeModelInputProvenance({
          headers: context.headers,
          payload: bodyInput,
          isInternalRequest: true,
          userId,
          workspaceId,
          modelInput: bodyInput.query,
        })
        if (!prepared.success) throw new OrchestrationError('validation', prepared.error)
        return prepared.registry
      },
    },
    request: { headers: context.headers },
  })
  throwIfAborted(context)
  const body = {
    success: true,
    data: {
      results: result.results.map(({ embeddingId: _embeddingId, ...item }) => item),
      query: result.query,
      knowledgeBaseIds: result.knowledgeBaseIds,
      knowledgeBaseId: result.knowledgeBaseId,
      topK: result.topK,
      totalResults: result.totalResults,
      ...(result.cost ? { cost: result.cost } : {}),
    },
  }
  if (!result.resultSecretRegistry) {
    throw new Error('Internal Knowledge search did not produce a provenance registry')
  }
  const finalization = finalizeKnowledgeRegistryResponse({
    headers: context.headers,
    authType: AuthType.INTERNAL_JWT,
    body,
    registry: result.resultSecretRegistry,
  })
  return { body, ...finalization }
}
