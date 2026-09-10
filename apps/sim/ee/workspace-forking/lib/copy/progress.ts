export interface ForkCopyProgress {
  completed: string[]
  tables: Record<string, { afterId: string; copied: number; lastOrderKey: string | null }>
  embeddings: Record<
    string,
    { afterId: string | null; sourceRevision: string; knowledgeBaseId: string }
  >
}

export interface ForkCopyControl {
  signal?: AbortSignal
  deadlineAt?: number
  progress?: ForkCopyProgress
  checkpoint?: (progress: ForkCopyProgress) => Promise<void>
}

/** A continuation after durable progress does not consume the outbox retry budget. */
export class ForkCopyContinuation extends Error {}
export class ForkCopyCheckpointError extends Error {}

export function assertForkCopyActive(control?: ForkCopyControl): void {
  control?.signal?.throwIfAborted()
  if (control?.checkpoint && control.deadlineAt && Date.now() >= control.deadlineAt - 30_000) {
    throw new ForkCopyContinuation('Continue resource copying from its checkpoint')
  }
}

export function rethrowForkCopyInterruption(error: unknown, control?: ForkCopyControl): void {
  control?.signal?.throwIfAborted()
  if (error instanceof ForkCopyContinuation) throw error
  if (error instanceof ForkCopyCheckpointError) throw error
}

/** Records the source generation before any resumable embedding writes. */
export async function bindForkCopyEmbeddings(
  control: ForkCopyControl | undefined,
  childDocumentId: string,
  knowledgeBaseId: string,
  sourceRevision: string
): Promise<string | null> {
  assertForkCopyActive(control)
  if (!control?.progress || !control.checkpoint) return null
  const cursor = control.progress.embeddings[childDocumentId]
  if (cursor) {
    if (cursor.sourceRevision !== sourceRevision || cursor.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error(
        `The source of copied document ${childDocumentId} changed after copying began`
      )
    }
    return cursor.afterId
  }
  control.progress.embeddings[childDocumentId] = {
    afterId: null,
    sourceRevision,
    knowledgeBaseId,
  }
  await control.checkpoint(control.progress)
  return null
}

export async function completeForkCopyResource(
  control: ForkCopyControl | undefined,
  key: string
): Promise<void> {
  control?.signal?.throwIfAborted()
  if (!control?.progress || !control.checkpoint) return
  if (!control.progress.completed.includes(key)) control.progress.completed.push(key)
  if (key.startsWith('table:')) delete control.progress.tables[key.slice('table:'.length)]
  if (key.startsWith('document:')) delete control.progress.embeddings[key.slice('document:'.length)]
  if (key.startsWith('knowledge-base:')) {
    const knowledgeBaseId = key.slice('knowledge-base:'.length)
    for (const [documentId, cursor] of Object.entries(control.progress.embeddings)) {
      if (cursor.knowledgeBaseId === knowledgeBaseId) delete control.progress.embeddings[documentId]
    }
  }
  await control.checkpoint(control.progress)
}
