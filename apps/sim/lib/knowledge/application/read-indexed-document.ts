import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import {
  resolveActiveKnowledgeResourceContext,
  resolveKnowledgeOrganizationContext,
} from '@/lib/knowledge/application/contexts'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { ChunkQueryResult } from '@/lib/knowledge/chunks/types'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/citation'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'
import {
  createKnowledgeDocumentSourceValue,
  importKnowledgePersistedResponseSecretProvenance,
} from '@/lib/knowledge/secret-provenance'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

type IndexedKnowledgeDocumentTarget =
  | { kind: 'id'; documentId: string }
  | { kind: 'url'; url: string }

export interface ReadIndexedKnowledgeDocumentInput {
  organizationId: string
  target: IndexedKnowledgeDocumentTarget
  limit: number
  offset?: number
  aroundChunkIndex?: number
  resultSecretRegistry: ResolvedSecretTraceRegistry
  signal?: AbortSignal
}

export interface ReadIndexedKnowledgeDocumentResult {
  knowledgeBaseId: string
  documentId: string
  title: string
  sourceUrl: string | null
  sourceModifiedAt: string | null
  connectorType: string | null
  processingStatus: string
  chunks?: { id: string; chunkIndex: number; content: string }[]
  pagination?: ChunkQueryResult['pagination']
}

function activeDocumentConditions(knowledgeBaseId: string, access: KnowledgeAccessScope) {
  return [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.enabled, true),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    knowledgeAccessCondition(access),
  ]
}

function validateReadInput(input: ReadIndexedKnowledgeDocumentInput) {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50 ||
    (input.offset !== undefined &&
      (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 1_000_000)) ||
    (input.aroundChunkIndex !== undefined &&
      (!Number.isInteger(input.aroundChunkIndex) ||
        input.aroundChunkIndex < 0 ||
        input.aroundChunkIndex > 1_000_000))
  ) {
    throw new OrchestrationError('validation', 'Invalid document page bounds')
  }
  if (input.offset !== undefined && input.aroundChunkIndex !== undefined) {
    throw new OrchestrationError('validation', 'Use offset or aroundChunkIndex, not both')
  }
  if (
    input.target.kind === 'url' &&
    (input.target.url.length > 8192 || !isKnowledgeSourceUrl(input.target.url.trim()))
  ) {
    throw new OrchestrationError('validation', 'url must be an HTTP or HTTPS document URL')
  }
}

/** Resolves only indexed references; URL lookup never contacts the provider or fetches content. */
export const readIndexedKnowledgeDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({ input }: { input: ReadIndexedKnowledgeDocumentInput }) => {
    input.signal?.throwIfAborted()
    validateReadInput(input)
    return resolveKnowledgeOrganizationContext({ organizationId: input.organizationId })
  },
  async execute({
    principal,
    input,
    context,
    request,
  }): Promise<ReadIndexedKnowledgeDocumentResult> {
    input.signal?.throwIfAborted()
    const assertions = {
      assertedOrganizationId: context.organizationId,
    }
    const index = await findSearchIndex({
      kind: 'organization',
      organizationId: context.organizationId,
    })
    if (!index) throw new OrchestrationError('not_found', 'Document not found')
    const knowledgeBaseId = index.id
    const knowledgeContext = await resolveActiveKnowledgeResourceContext(
      { knowledgeBaseId, ...assertions },
      principal
    )
    const access = await knowledgeContext.access.get()
    let documentId: string
    if (input.target.kind === 'id') {
      documentId = input.target.documentId
    } else {
      const matches = await db
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            ...activeDocumentConditions(knowledgeBaseId, access),
            eq(document.sourceUrl, input.target.url.trim())
          )
        )
        .limit(2)
      if (!matches.length) throw new OrchestrationError('not_found', 'Document not found')
      if (matches.length > 1) {
        throw new OrchestrationError(
          'validation',
          'Multiple accessible documents use this URL. Use documentId from search.'
        )
      }
      documentId = matches[0].id
    }
    input.signal?.throwIfAborted()
    const { document: doc } = await readKnowledgeDocument.execute({
      principal,
      input: { knowledgeBaseId, documentId, ...assertions, requireEnabledDocument: true },
      request,
    })
    const value: ReadIndexedKnowledgeDocumentResult = {
      knowledgeBaseId,
      documentId: doc.id,
      title: doc.filename,
      sourceUrl: doc.sourceUrl,
      sourceModifiedAt: doc.sourceModifiedAt?.toISOString() ?? null,
      connectorType: doc.connectorType,
      processingStatus: doc.processingStatus,
    }
    const provenanceContext = {
      registry: input.resultSecretRegistry,
      actorUserId: resolvePrincipalSubjectUserId(principal) ?? undefined,
    }
    if (
      !(await importKnowledgePersistedResponseSecretProvenance({
        ...provenanceContext,
        documents: [{ id: doc.id, source: createKnowledgeDocumentSourceValue(doc), value }],
      }))
    ) {
      throw new Error('Knowledge document provenance is unavailable')
    }
    input.signal?.throwIfAborted()
    if (doc.processingStatus !== 'completed') return value

    let offset = input.offset ?? 0
    if (input.aroundChunkIndex !== undefined) {
      const [position] = await db
        .select({
          matched:
            sql<number>`count(*) filter (where ${embedding.chunkIndex} = ${input.aroundChunkIndex})`.mapWith(
              Number
            ),
          preceding:
            sql<number>`count(*) filter (where ${embedding.chunkIndex} < ${input.aroundChunkIndex})`.mapWith(
              Number
            ),
        })
        .from(embedding)
        .innerJoin(document, eq(document.id, embedding.documentId))
        .where(
          and(
            ...activeDocumentConditions(knowledgeBaseId, access),
            eq(document.id, documentId),
            eq(embedding.enabled, true),
            lte(embedding.chunkIndex, input.aroundChunkIndex)
          )
        )
      if (!position?.matched) throw new OrchestrationError('not_found', 'Document chunk not found')
      offset = Math.max(0, position.preceding - Math.min(2, input.limit - 1))
    }
    input.signal?.throwIfAborted()
    const page = await listKnowledgeChunks.execute({
      principal,
      input: {
        knowledgeBaseId,
        documentId,
        ...assertions,
        requireEnabledDocument: true,
        enabled: 'true',
        sortBy: 'chunkIndex',
        sortOrder: 'asc',
        limit: input.limit,
        offset,
      },
      request,
    })
    const chunks = page.chunks.map(({ id, chunkIndex, content }) => ({ id, chunkIndex, content }))
    if (
      !(await importKnowledgePersistedResponseSecretProvenance({
        ...provenanceContext,
        chunks: chunks.map((chunk) => ({ ...chunk, documentId, value: chunk })),
      }))
    ) {
      throw new Error('Knowledge chunk provenance is unavailable')
    }
    input.signal?.throwIfAborted()
    return { ...value, chunks, pagination: page.pagination }
  },
})
