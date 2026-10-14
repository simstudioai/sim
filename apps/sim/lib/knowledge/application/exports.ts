import { AsyncLocalStorage } from 'node:async_hooks'
import type { Readable } from 'node:stream'
import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import {
  admitContent,
  ContentRefusedError,
  mustClassifyContent,
  requireAdmittedContent,
} from '@/lib/core/application'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveActiveKnowledgeBaseContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { KNOWLEDGE_BUNDLE_VERSION } from '@/lib/knowledge/constants'
import { toKbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import {
  classifyKnowledgeChunkContent,
  classifyKnowledgeDocumentMetadata,
  loadKnowledgeDocumentDurableSecretProvenance,
} from '@/lib/knowledge/secret-provenance'
import {
  bundleEntryPaths,
  type KnowledgeBundleManifest,
  type KnowledgeBundleTag,
  parseDescribableBundle,
  toManifestDocument,
} from '@/lib/knowledge/transfer/bundle'
import { openKnowledgeExportFile } from '@/lib/knowledge/transfer/export-archive'
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
  file(document: ExportableDocument): Promise<Readable | Buffer>
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
  async execute({ principal, input, context }): Promise<KnowledgeBaseExportBundle> {
    const { knowledgeBase } = context
    const dimension = toKbEmbeddingDimensions(knowledgeBase.embeddingDimension)
    const [tags, documents] = await Promise.all([
      listExportableTags(knowledgeBase.id),
      listExportableDocuments(knowledgeBase.id),
    ])
    const classify = mustClassifyContent(principal)
    const inExportContext = AsyncLocalStorage.snapshot()
    const documentById = new Map(documents.map((document) => [document.id, document]))
    const snapshot = (document: ExportableDocument) => ({
      filename: document.filename,
      ...document.tags,
    })
    // Deferred bytes are admitted in the captured context as their stream reaches each source.
    await admitContent(principal, [])
    const manifest = parseDescribableBundle({
      version: KNOWLEDGE_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      embedding: {
        model: knowledgeBase.embeddingModel,
        dimension,
        vectorsIncluded: input.vectors,
      },
      knowledgeBase: {
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        chunkingConfig: knowledgeBase.chunkingConfig,
      },
      tags,
      documents: documents.map((document) =>
        toManifestDocument(document, bundleEntryPaths(document), document.storedChunkCount)
      ),
    })
    return {
      knowledgeBase: manifest.knowledgeBase,
      embedding: manifest.embedding,
      tags: manifest.tags,
      documents,
      file: (document) =>
        inExportContext(async () => {
          if (!document.file) throw new ContentRefusedError('knowledge-document')
          if (!classify) return openKnowledgeExportFile(document.file)
          const current = await loadKnowledgeDocumentDurableSecretProvenance(
            document.id,
            snapshot(document)
          )
          if (
            current.knowledgeBaseId !== knowledgeBase.id ||
            (document.file.kind === 'storage' && current.storageKey !== document.file.key) ||
            (document.file.kind === 'data-uri' && current.storageKey !== null)
          ) {
            throw new ContentRefusedError('knowledge-document')
          }
          await requireAdmittedContent(principal, {
            kind: 'knowledge-document',
            id: document.id,
            provenance: current.provenance,
            view: 'opaque',
          })
          return openKnowledgeExportFile(document.file, current.source.fileUrl)
        }),
      chunks: async function* (documentId) {
        const document = documentById.get(documentId)
        if (!document) throw new ContentRefusedError('knowledge-document')
        if (classify) {
          await inExportContext(async () => {
            const provenance = await classifyKnowledgeDocumentMetadata(
              [documentId],
              new Map([[documentId, [snapshot(document)]]])
            )
            await requireAdmittedContent(principal, {
              kind: 'knowledge-document',
              id: documentId,
              provenance: provenance.get(documentId) ?? { status: 'unknown' },
              view: 'opaque',
            })
          })
        }
        yield* iterateDocumentChunks(
          knowledgeBase.id,
          documentId,
          input.vectors ? dimension : null,
          classify
            ? (page) =>
                inExportContext(async () => {
                  const provenance = await classifyKnowledgeChunkContent(
                    page.map((chunk) => ({ ...chunk, documentId }))
                  )
                  const sources = page.map((chunk) => ({
                    kind: 'knowledge-chunk' as const,
                    id: chunk.id,
                    provenance: provenance.get(chunk.id) ?? { status: 'unknown' as const },
                    view: 'opaque' as const,
                  }))
                  if ((await admitContent(principal, sources)).refused.length > 0) {
                    throw new ContentRefusedError('knowledge-chunk')
                  }
                })
            : undefined
        )
      },
    }
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
