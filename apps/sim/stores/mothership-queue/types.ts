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
   * The failed dispatch got no response while the browser was offline, so the
   * server may or may not have admitted it; the browser being online again
   * releases it for dispatch under the same id, which the server deduplicates
   * if it did.
   */
  heldUntilOnline?: boolean
  /**
   * Set on a send held by a chatless surface, whose queue key dies with its
   * mount: the next chatless surface for the same owner and workflow adopts it.
   */
  heldSurface?: string
  /** Automatic retries so far (busy refusals, or failures to reach Sim while online); paces the next. */
  sendRetries?: number
  /** Epoch ms before which a message waiting on an automatic retry is not sent again. */
  notBefore?: number
  /**
   * Message id of a prior attempt at this send that an unmount cleanup
   * withdrew. Reused when the entry is dispatched so the server deduplicates
   * against that attempt — it never sees the client's abort, so a request it
   * had already accepted still opened the chat and billed the turn. Persisted,
   * so a retry after a reload deduplicates too.
   */
  resumeUserMessageId?: string
}

/** When a message's next automatic retry may go out, and how many came before it. */
export interface ScheduledRetry {
  sendRetries: number
  notBefore: number
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
   * Chats cleared this session (deleted), each with the token of its latest
   * delete. No write recreates their queue (a late restore, or a failed send
   * handed back); restoring the chat lifts it.
   */
  cleared: Record<string, number>
  /**
   * Where each new-chat key's queue moved when its chat became known
   * (`migrate`). A write that captured the old key before an `await` follows
   * this (`liveQueueKey`), so it lands in the chat's queue, not a dead key.
   */
  migratedTo: Record<string, string>

  enqueue: (chatKey: string, message: QueuedMothershipMessage) => void
  insertAt: (chatKey: string, index: number, message: QueuedMothershipMessage) => void
  replaceAt: (chatKey: string, id: string, patch: QueuedMessageEditPatch) => void
  remove: (chatKey: string, id: string) => void
  setEditing: (chatKey: string, id: string | null) => void
  migrate: (fromKey: string, toKey: string) => void
  /** Releases every send held for the network for dispatch. */
  releaseHeldUntilOnline: () => void
  /** Puts off the automatic retry of `id` until `notBefore`. */
  deferRetry: (chatKey: string, id: string, retry: ScheduledRetry) => void
  /** Moves the sends a dead chatless mount of `surface` held onto `toKey`. */
  adoptHeldSends: (toKey: string, surface: string) => void
  /**
   * Marks everything queued under a chatless mount's key as held for its
   * `surface`, as that mount goes away: the key dies with it, and the next
   * mount of the surface adopts the messages instead of losing them.
   */
  holdForSurface: (chatKey: string, surface: string) => void
  clearChat: (chatKey: string) => void
  /**
   * Lifts the delete an operation saw when it began (`cleared[chatKey]` read
   * then), for a read or restore that found the chat. A delete that landed
   * after it has a newer token and stays.
   */
  liftDelete: (chatKey: string, deleteToken: number) => void
  /**
   * Lifts any delete of a chat the server announced as restored (its `created`
   * event, published after every delete before it).
   */
  reopenRestoredChat: (chatKey: string) => void
  reset: () => void
}
