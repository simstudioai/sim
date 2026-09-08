import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveActiveKnowledgeBaseContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { KNOWLEDGE_BUNDLE_VERSION } from '@/lib/knowledge/constants'
import { toKbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import {
  assertDescribableByBundle,
  bundleEntryPaths,
  type KnowledgeBundleManifest,
  type KnowledgeBundleTag,
  toManifestDocument,
} from '@/lib/knowledge/transfer/bundle'
import {
  type ExportableChunk,
  type ExportableDocument,
  iterateDocumentChunks,
  listExportableDocuments,
  listExportableTags,
} from '@/lib/knowledge/transfer/export-source'

export interface ExportKnowledgeBaseInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  /** Carry chunk vectors so a same-model import can reuse them instead of re-embedding. */
  vectors: boolean
}

/**
 * Everything an export archive is built from. Document metadata is loaded
 * eagerly because it is small and the manifest needs all of it; chunk content
 * is handed over as a generator so the archive can stream it document by
 * document.
 */
export interface KnowledgeBaseExportBundle {
  knowledgeBase: KnowledgeBundleManifest['knowledgeBase']
  embedding: KnowledgeBundleManifest['embedding']
  tags: KnowledgeBundleTag[]
  documents: ExportableDocument[]
  chunks(documentId: string): AsyncIterable<ExportableChunk>
}

export const exportKnowledgeBase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.export,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ExportKnowledgeBaseInput
  }) => resolveActiveKnowledgeBaseContext(input, principal),
  async execute({ input, context }): Promise<KnowledgeBaseExportBundle> {
    const { knowledgeBase } = context
    const dimension = toKbEmbeddingDimensions(knowledgeBase.embeddingDimension)
    const [tags, documents] = await Promise.all([
      listExportableTags(knowledgeBase.id),
      listExportableDocuments(knowledgeBase.id),
    ])
    const bundle: KnowledgeBaseExportBundle = {
      knowledgeBase: {
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        chunkingConfig: knowledgeBase.chunkingConfig,
      },
      embedding: {
        model: knowledgeBase.embeddingModel,
        dimension,
        vectorsIncluded: input.vectors,
      },
      tags,
      documents,
      chunks: (documentId) => iterateDocumentChunks(documentId, input.vectors ? dimension : null),
    }
    assertDescribableByBundle({
      version: KNOWLEDGE_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      embedding: bundle.embedding,
      knowledgeBase: bundle.knowledgeBase,
      tags,
      documents: documents.map((document) =>
        toManifestDocument(document, bundleEntryPaths(document), 0)
      ),
    })
    return bundle
  },
  projectAudit: ({ context, input, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_EXPORTED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: context.knowledgeBase.id,
    resourceName: context.knowledgeBase.name,
    description: `Exported knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      workspaceId: context.workspaceId,
      vectors: input.vectors,
      documentCount: result.documents.length,
    },
  }),
})
