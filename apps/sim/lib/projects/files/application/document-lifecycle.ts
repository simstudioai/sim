import { workspaceFiles } from '@sim/db/schema'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { loadCollabDocState, saveCollabDocStateInTx } from '@/lib/collab-doc/collab-state'
import {
  enqueueOutboxEvent,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import { retireLiveFileDoc } from '@/lib/realtime/notify'

const RETIRE_DOCUMENT_EVENT = 'project-file.document.retire'

interface ProjectDocumentRetirement {
  projectId: string
  fileId: string
  retiredDocId: string
  replacementDocId: string
}

function documentIdentity(state: Uint8Array): string {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    const id = doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    if (typeof id !== 'string' || !id || id.length > 128)
      throw new Error('Project document has no valid cached identity')
    return id
  } finally {
    doc.destroy()
  }
}

/** Read a bounded canonical identity while the caller holds the authorized file row lock. */
export async function readProjectFileDocIdInTx(tx: DbTransaction, fileId: string) {
  const cached = await loadCollabDocState(fileId, undefined, tx)
  return cached ? documentIdentity(cached.docState) : null
}

/** Archive and restore retire the cached history atomically with the file lifecycle mutation. */
export async function rotateProjectFileDocInTx(
  tx: DbTransaction,
  target: { projectId: string; fileId: string }
): Promise<{ outboxEventId: string } | null> {
  const [file] = await tx
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, target.fileId),
        eq(workspaceFiles.projectId, target.projectId),
        eq(workspaceFiles.context, 'project')
      )
    )
    .for('update')
    .limit(1)
  if (!file) throw new Error('Project document lifecycle target does not match its owner')
  const cached = await loadCollabDocState(target.fileId, undefined, tx)
  if (!cached) return null
  const retiredDocId = documentIdentity(cached.docState)
  const replacementDocId = generateId()
  const replacement = new Y.Doc()
  try {
    replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, replacementDocId)
    await saveCollabDocStateInTx(tx, target.fileId, {
      docState: Y.encodeStateAsUpdate(replacement),
      sourceHash: '',
      expectedState: cached,
    })
  } finally {
    replacement.destroy()
  }
  const payload: ProjectDocumentRetirement = { ...target, retiredDocId, replacementDocId }
  return { outboxEventId: await enqueueOutboxEvent(tx, RETIRE_DOCUMENT_EVENT, payload) }
}

export const projectFileDocumentOutboxHandlers = {
  [RETIRE_DOCUMENT_EVENT]: async (payload, context) => {
    if (
      !isRecordLike(payload) ||
      typeof payload.projectId !== 'string' ||
      !payload.projectId ||
      typeof payload.fileId !== 'string' ||
      !payload.fileId ||
      typeof payload.retiredDocId !== 'string' ||
      !payload.retiredDocId ||
      typeof payload.replacementDocId !== 'string' ||
      !payload.replacementDocId
    )
      throw new Error('Invalid Project document retirement')
    context.signal.throwIfAborted()
    await retireLiveFileDoc(
      {
        owner: { entityType: 'project', entityId: payload.projectId },
        fileId: payload.fileId,
        retiredDocId: payload.retiredDocId,
        replacementDocId: payload.replacementDocId,
      },
      context.signal
    )
  },
} satisfies OutboxHandlerRegistry

/** Attempt committed retirement immediately; the durable worker retries unavailable relays. */
export function processProjectFileDocRetirementNow(eventId: string) {
  return processOutboxEventById(eventId, projectFileDocumentOutboxHandlers)
}
