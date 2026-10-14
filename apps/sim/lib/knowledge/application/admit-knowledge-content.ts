import type { Principal } from '@sim/auth/principal'
import { admitEach, type ContentSourceKind } from '@/lib/core/application'
import {
  classifyKnowledgeChunks,
  classifyKnowledgeDocumentMetadata,
  type KnowledgeDocumentSnapshot,
  knowledgeDocumentSnapshot,
} from '@/lib/knowledge/secret-provenance'

interface KnowledgeAdmissionOptions {
  /** The items are what a committed write returns; see `admitWrittenContent`. */
  written?: boolean
}

const writtenAs = (options: KnowledgeAdmissionOptions, kind: ContentSourceKind) =>
  options.written ? { written: kind } : {}

/**
 * Admits each document whose rendered metadata a result returns, on its own, and returns the ids
 * admitted. `value` is what the result shows of the document, so only secrets it contains are
 * imported; `snapshot` names the stored fields it shows, when they are not its own keys. A caller
 * no gate observes gets every id back without a provenance read.
 */
export async function admitKnowledgeDocuments(
  principal: Principal,
  documents: readonly { id: string; value: unknown; snapshot?: KnowledgeDocumentSnapshot }[],
  options: KnowledgeAdmissionOptions = {}
): Promise<Set<string>> {
  const admitted = await admitEach(
    principal,
    documents,
    async (items) => {
      /** Each classification is bound to the metadata the item shows; see the classifier. */
      const snapshots = new Map<string, KnowledgeDocumentSnapshot[]>()
      for (const item of items) {
        const snapshot = item.snapshot ?? knowledgeDocumentSnapshot(item.value)
        if (snapshot) snapshots.set(item.id, [...(snapshots.get(item.id) ?? []), snapshot])
      }
      const provenance = await classifyKnowledgeDocumentMetadata(
        items.map((item) => item.id),
        snapshots
      )
      return items.map((item) => ({
        kind: 'knowledge-document' as const,
        id: item.id,
        provenance: provenance.get(item.id) ?? { status: 'unknown' as const },
        view: { derived: item.value },
      }))
    },
    writtenAs(options, 'knowledge-document')
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
  chunks: readonly {
    id: string
    documentId: string
    content: string
    value?: unknown
    snapshot?: KnowledgeDocumentSnapshot
  }[],
  options: KnowledgeAdmissionOptions = {}
): Promise<Set<string>> {
  const admitted = await admitEach(
    principal,
    chunks,
    async (items) => {
      const provenance = await classifyKnowledgeChunks(
        items.map((chunk) => ({
          ...chunk,
          snapshot: chunk.snapshot ?? knowledgeDocumentSnapshot(chunk.value ?? chunk),
        }))
      )
      return items.map((chunk) => ({
        kind: 'knowledge-chunk' as const,
        id: chunk.id,
        provenance: provenance.get(chunk.id) ?? { status: 'unknown' as const },
        view: chunk.value === undefined ? ('complete' as const) : { derived: chunk.value },
      }))
    },
    writtenAs(options, 'knowledge-chunk')
  )
  return new Set(admitted.map((chunk) => chunk.id))
}
