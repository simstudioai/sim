import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

/** Durable predecessor and request identity for an outgoing message. */
export interface QueuedSendHandoffSeed {
  id: string
  chatId?: string
  supersededStreamId: string | null
  userMessageId?: string
  stopRequired?: boolean
}

export type QueuedMothershipMessage = QueuedMessage & {
  queuedSendHandoff?: QueuedSendHandoffSeed
  /** A failed dispatch remains queued until the user retries or edits it. */
  retryRequired?: boolean
  /**
   * The failed dispatch got no response, so the server may or may not have
   * admitted it; the browser being online releases it for dispatch under the
   * same id, which the server deduplicates if it did.
   */
  heldUntilOnline?: boolean
  /**
   * Set on a send held by a chatless surface, whose queue key dies with its
   * mount: the next chatless surface for the same owner and workflow adopts it.
   */
  heldSurface?: string
  /**
   * Message id of a prior attempt at this send that an unmount cleanup
   * withdrew. Reused when the entry is dispatched so the server deduplicates
   * against that attempt — it never sees the client's abort, so a request it
   * had already accepted still opened the chat and billed the turn. Persisted,
   * so a retry after a reload deduplicates too.
   */
  resumeUserMessageId?: string
}

// Mutable fields an in-place edit overwrites; id and index are preserved by `replaceAt`.
export type QueuedMessageEditPatch = Pick<
  QueuedMessage,
  | 'content'
  | 'fileAttachments'
  | 'contexts'
  | 'requestMode'
  | 'assistantSearch'
  | 'assistantSearchLevel'
>

export interface MothershipQueueState {
  queues: Record<string, QueuedMothershipMessage[]>
  editing: Record<string, string>
  /**
   * Chats cleared this session (deleted). A late restore of a send dispatched
   * before the clear does not recreate their queue; a new enqueue lifts it.
   */
  cleared: Record<string, true>

  enqueue: (chatKey: string, message: QueuedMothershipMessage) => void
  insertAt: (chatKey: string, index: number, message: QueuedMothershipMessage) => void
  replaceAt: (chatKey: string, id: string, patch: QueuedMessageEditPatch) => void
  remove: (chatKey: string, id: string) => void
  setEditing: (chatKey: string, id: string | null) => void
  migrate: (fromKey: string, toKey: string) => void
  /** Releases every send held for the network for dispatch. */
  releaseHeldUntilOnline: () => void
  /** Moves the sends a dead chatless mount of `surface` held onto `toKey`. */
  adoptHeldSends: (toKey: string, surface: string) => void
  clearChat: (chatKey: string) => void
  reset: () => void
}
