import type { Principal } from '@sim/auth/principal'
import { admitEach } from '@/lib/core/application/content-delivery'
import {
  classifyKnowledgeChunks,
  classifyKnowledgeDocumentMetadata,
} from '@/lib/knowledge/secret-provenance'

interface KnowledgeAdmissionOptions {
  /** The items are what a committed write returns; see `admitWrittenContent`. */
  written?: boolean
}

/**
 * Admits each document whose rendered metadata a result returns, on its own, and returns the ids
 * admitted. `value` is what the result shows of the document, so only secrets it contains are
 * imported. A caller no gate observes gets every id back without a provenance read.
 */
export async function admitKnowledgeDocuments(
  principal: Principal,
  documents: readonly { id: string; value: unknown }[],
  options: KnowledgeAdmissionOptions = {}
): Promise<Set<string>> {
  const admitted = await admitEach(
    principal,
    documents,
    async (items) => {
      const provenance = await classifyKnowledgeDocumentMetadata(items.map((item) => item.id))
      return items.map((item) => ({
        kind: 'knowledge-document' as const,
        id: item.id,
        provenance: provenance.get(item.id) ?? { status: 'unknown' as const },
        view: { derived: item.value },
      }))
    },
    options
  )
  return new Set(admitted.map((item) => item.id))
}

/**
 * Admits each chunk a result returns, on its own: its content's provenance merged with that of the
 * document whose metadata it carries. `value` is what the result shows of the chunk; without one,
 * every secret the chunk and its document can hold counts. Returns the ids admitted.
 */
export async function admitKnowledgeChunks(
  principal: Principal,
  chunks: readonly { id: string; documentId: string; content: string; value?: unknown }[],
  options: KnowledgeAdmissionOptions = {}
): Promise<Set<string>> {
  const admitted = await admitEach(
    principal,
    chunks,
    async (items) => {
      const provenance = await classifyKnowledgeChunks(items)
      return items.map((chunk) => ({
        kind: 'knowledge-chunk' as const,
        id: chunk.id,
        provenance: provenance.get(chunk.id) ?? { status: 'unknown' as const },
        view: chunk.value === undefined ? ('complete' as const) : { derived: chunk.value },
      }))
    },
    options
  )
  return new Set(admitted.map((chunk) => chunk.id))
}
