import { isRecordLike } from '@sim/utils/object'
import type { OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { retireLiveProjectFileDoc } from '@/lib/realtime/notify'

const RETIRE_DOCUMENT_EVENT = 'project-file.document.retire'

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
    await retireLiveProjectFileDoc(
      {
        projectId: payload.projectId,
        fileId: payload.fileId,
        retiredDocId: payload.retiredDocId,
        replacementDocId: payload.replacementDocId,
      },
      context.signal
    )
  },
} satisfies OutboxHandlerRegistry
