import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createDurableSecretProvenanceRegistry,
  type DurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { reportDurableSecretProvenanceRefusal } from '@/lib/execution/durable-secret-provenance-enforcement'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import {
  type ActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeChunkContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  batchChunkOperation,
  createChunk,
  deleteChunk,
  queryChunks,
  updateChunk,
} from '@/lib/knowledge/chunks/service'
import type { ChunkFilters } from '@/lib/knowledge/chunks/types'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('KnowledgeChunkApplication')

interface KnowledgeDocumentChunkInput {
  knowledgeBaseId: string
  documentId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
}

interface KnowledgeChunkInput extends KnowledgeDocumentChunkInput {
  chunkId: string
}

interface ResolveChunkProvenanceInput {
  userId: string
  workspaceId?: string
}

export interface ListKnowledgeChunksInput extends KnowledgeDocumentChunkInput, ChunkFilters {}

export interface CreateKnowledgeChunkInput extends KnowledgeDocumentChunkInput {
  content: string
  enabled?: boolean
  resolveContentProvenance(input: ResolveChunkProvenanceInput): DurableSecretProvenance | undefined
}

export interface UpdateKnowledgeChunkInput extends KnowledgeChunkInput {
  content?: string
  enabled?: boolean
  resolveContentProvenance(input: ResolveChunkProvenanceInput): DurableSecretProvenance | undefined
}

export interface BulkKnowledgeChunksInput extends KnowledgeDocumentChunkInput {
  operation: 'enable' | 'disable' | 'delete'
  chunkIds: string[]
}

function requireChunkReadable(context: ActiveKnowledgeDocumentContext): void {
  if (context.document.processingStatus !== 'completed') {
    throw new KnowledgeDocumentNotReadyError(context.document.processingStatus)
  }
}

function requireChunkWritable(context: ActiveKnowledgeDocumentContext): void {
  if (context.document.connectorId) {
    throw new ForbiddenOperationError(
      'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
      'Chunks from connector-synced documents are read-only'
    )
  }
}

function documentTags(context: ActiveKnowledgeDocumentContext) {
  const document = context.document
  return {
    tag1: document.tag1 ?? null,
    tag2: document.tag2 ?? null,
    tag3: document.tag3 ?? null,
    tag4: document.tag4 ?? null,
    tag5: document.tag5 ?? null,
    tag6: document.tag6 ?? null,
    tag7: document.tag7 ?? null,
    number1: document.number1 ?? null,
    number2: document.number2 ?? null,
    number3: document.number3 ?? null,
    number4: document.number4 ?? null,
    number5: document.number5 ?? null,
    date1: document.date1 ?? null,
    date2: document.date2 ?? null,
    boolean1: document.boolean1 ?? null,
    boolean2: document.boolean2 ?? null,
    boolean3: document.boolean3 ?? null,
  }
}

export const listKnowledgeChunks = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listChunks,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ListKnowledgeChunksInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ input, context }) {
    if (input.requireEnabledDocument && !context.document.enabled) {
      throw new OrchestrationError('not_found', 'Document not found')
    }
    requireChunkReadable(context)
    const {
      knowledgeBaseId: _knowledgeBaseId,
      documentId,
      assertedWorkspaceId: _scope,
      assertedOrganizationId: _organizationScope,
      ...filters
    } = input
    const result = await queryChunks(
      documentId,
      filters,
      generateRequestId(),
      await context.access.get()
    )
    return { ...result, workspaceId: context.workspaceId, documentId }
  },
})

export const readKnowledgeChunk = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readChunk,
  resolveContext: ({ principal, input }: { principal: Principal; input: KnowledgeChunkInput }) =>
    resolveActiveKnowledgeChunkContext(input, principal),
  async execute({ context }) {
    requireChunkReadable(context)
    return {
      chunk: context.chunk,
      workspaceId: context.workspaceId,
      documentId: context.documentId,
    }
  },
})

export const createKnowledgeChunk = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createChunk,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeChunkInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ principal, input, context }) {
    requireChunkWritable(context)
    if (context.document.processingStatus === 'failed') {
      throw new OrchestrationError('validation', 'Cannot add chunks to failed document')
    }
    const userId = resolveKnowledgeAttributedUserId(principal, context)
    const provenance = input.resolveContentProvenance({ userId, workspaceId: context.workspaceId })
    if (provenance?.status === 'unknown') {
      reportDurableSecretProvenanceRefusal({
        surface: 'knowledge',
        cause: 'knowledge-chunk-source-unavailable',
        workspaceId: context.workspaceId,
        resourceId: context.documentId,
      })
      throw new OrchestrationError('validation', 'Knowledge chunk secret provenance is unavailable')
    }
    const registry = provenance
      ? await createDurableSecretProvenanceRegistry(provenance, {
          userId,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        })
      : undefined
    const chunk = await runWithKnowledgeModelInputProvenance(registry, () =>
      createChunk(
        context.knowledgeBaseId,
        context.documentId,
        documentTags(context),
        { content: input.content, enabled: input.enabled },
        generateRequestId(),
        context.workspaceId,
        provenance
      )
    )
    let cost: ReturnType<typeof calculateCost> | null = null
    try {
      cost = calculateCost(context.knowledgeBase.embeddingModel, chunk.tokenCount, 0, false)
    } catch (error) {
      logger.warn('Failed to calculate cost for chunk upload', { error })
    }
    return {
      chunk: {
        ...chunk,
        documentId: context.documentId,
        documentName: context.document.filename,
        ...(cost
          ? {
              cost: {
                input: cost.input,
                output: cost.output,
                total: cost.total,
                tokens: { prompt: chunk.tokenCount, completion: 0, total: chunk.tokenCount },
                model: context.knowledgeBase.embeddingModel,
                pricing: cost.pricing,
              },
            }
          : {}),
      },
      provenance,
      workspaceId: context.workspaceId,
      userId,
    }
  },
})

export const updateKnowledgeChunk = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateChunk,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeChunkInput
  }) => resolveActiveKnowledgeChunkContext(input, principal),
  async execute({ principal, input, context }) {
    requireChunkReadable(context)
    requireChunkWritable(context)
    const userId = resolveKnowledgeAttributedUserId(principal, context)
    const provenance = input.resolveContentProvenance({ userId, workspaceId: context.workspaceId })
    if (provenance?.status === 'unknown') {
      reportDurableSecretProvenanceRefusal({
        surface: 'knowledge',
        cause: 'knowledge-chunk-source-unavailable',
        workspaceId: context.workspaceId,
        resourceId: context.documentId,
      })
      throw new OrchestrationError('validation', 'Knowledge chunk secret provenance is unavailable')
    }
    const registry = provenance
      ? await createDurableSecretProvenanceRegistry(provenance, {
          userId,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        })
      : undefined
    const chunk = await runWithKnowledgeModelInputProvenance(registry, () =>
      updateChunk(
        context.chunkId,
        { content: input.content, enabled: input.enabled },
        generateRequestId(),
        context.workspaceId,
        provenance
      )
    )
    return { chunk, workspaceId: context.workspaceId, documentId: context.documentId }
  },
})

export const deleteKnowledgeChunk = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteChunk,
  resolveContext: ({ principal, input }: { principal: Principal; input: KnowledgeChunkInput }) =>
    resolveActiveKnowledgeChunkContext(input, principal),
  async execute({ context }) {
    requireChunkReadable(context)
    requireChunkWritable(context)
    await deleteChunk(context.chunkId, context.documentId, generateRequestId())
    return { deleted: true as const }
  },
})

export const bulkUpdateKnowledgeChunks = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkChunks,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: BulkKnowledgeChunksInput
  }) => resolveCanonicalActiveKnowledgeDocumentContext(input, principal),
  async execute({ input, context }) {
    requireChunkWritable(context)
    const result = await batchChunkOperation(
      context.documentId,
      input.operation,
      input.chunkIds,
      generateRequestId()
    )
    return {
      operation: input.operation,
      successCount: result.processed,
      errorCount: result.errors.length,
      processed: result.processed,
      errors: result.errors,
    }
  },
})
