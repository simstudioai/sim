import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

// Volatile — lets the dispatcher claim an in-flight stream's slot. Not persisted.
export interface QueuedSendHandoffSeed {
  id: string
  chatId?: string
  supersededStreamId: string | null
  userMessageId?: string
}

export type QueuedMothershipMessage = QueuedMessage & {
  queuedSendHandoff?: QueuedSendHandoffSeed
}

// Mutable fields an in-place edit overwrites; id and index are preserved by `replaceAt`.
export type QueuedMessageEditPatch = Pick<QueuedMessage, 'content' | 'fileAttachments' | 'contexts'>

export interface MothershipQueueState {
  queues: Record<string, QueuedMothershipMessage[]>
  editing: Record<string, string>

  enqueue: (chatKey: string, message: QueuedMothershipMessage) => void
  insertAt: (chatKey: string, index: number, message: QueuedMothershipMessage) => void
  replaceAt: (chatKey: string, id: string, patch: QueuedMessageEditPatch) => void
  remove: (chatKey: string, id: string) => void
  setEditing: (chatKey: string, id: string | null) => void
  migrate: (fromKey: string, toKey: string) => void
  clearChat: (chatKey: string) => void
  reset: () => void
}
