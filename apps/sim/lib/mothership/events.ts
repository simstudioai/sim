import { createLogger } from '@sim/logger'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
} from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

const logger = createLogger('MothershipEvents')

/**
 * Dispatches a cancelable window event and reports whether a mounted consumer
 * claimed it. Consumers claim by calling `preventDefault`, which makes
 * `dispatchEvent` return `false` — so an unclaimed event is one no listener
 * handled, and the producer falls back to persisting a handoff.
 */
function dispatchClaimable<T>(name: string, detail: T): boolean {
  return !window.dispatchEvent(new CustomEvent<T>(name, { detail, cancelable: true }))
}

/**
 * Custom-event name used to send a user message to the Mothership chat.
 * The mothership host components (workspace home, workflow panel) listen
 * for this event and call their `sendMessage` on receipt.
 */
export const MOTHERSHIP_SEND_MESSAGE_EVENT = 'mothership-send-message'

export interface MothershipSendMessageDetail {
  message: string
  /** Structured contexts to attach — e.g. a `logs` mention tagging a run. */
  contexts?: ChatContext[]
  /** Already-uploaded attachments riding along with the message. */
  fileAttachments?: FileAttachmentForApi[]
  /**
   * Set only when this message is the recovery of a send an unmount cleanup
   * withdrew: that attempt's message id. The receiving chat reuses it so the
   * server deduplicates against the first attempt instead of opening a second
   * chat and billing a second turn.
   */
  resumeUserMessageId?: string
  /** The request mode the withdrawn send asked for, so a retry stays the same kind of turn. */
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
}

/**
 * Dispatches a message to a mounted Mothership chat. Producers (terminal block
 * errors, console copilot actions, toast actions, the log "Troubleshoot in
 * Chat" action) call this.
 *
 * @returns `true` when a mounted host consumed the message, `false` when none
 * was listening — callers that can fall back (e.g. cross-route navigation) use
 * this to decide whether to persist a handoff instead.
 */
export function sendMothershipMessage(
  message: string,
  contexts?: ChatContext[],
  fileAttachments?: FileAttachmentForApi[],
  resumeUserMessageId?: string,
  requestMode?: ChatRequestMode,
  assistantSearch?: WorkspaceSearchFilters
): boolean {
  const trimmed = message.trim()
  if (!trimmed) {
    logger.warn('sendMothershipMessage called with empty message')
    return false
  }
  const consumed = dispatchClaimable<MothershipSendMessageDetail>(MOTHERSHIP_SEND_MESSAGE_EVENT, {
    message: trimmed,
    contexts,
    fileAttachments,
    ...(resumeUserMessageId ? { resumeUserMessageId } : {}),
    ...(requestMode ? { requestMode } : {}),
    ...(assistantSearch ? { assistantSearch } : {}),
  })
  logger.info('Dispatched mothership message event', { messageLength: trimmed.length, consumed })
  return consumed
}

/**
 * Custom-event name used to attach a context chip to the Mothership chat input
 * WITHOUT sending a message. The mounted chat input listens for this and inserts
 * the chip, leaving the user to type their prompt and send when ready.
 *
 * Kept separate from {@link MOTHERSHIP_SEND_MESSAGE_EVENT} because the consumer
 * differs: "send now" is claimed by the chat host, "attach a chip" by the input.
 * Folding both into one event would make two listeners race to claim it.
 */
export const MOTHERSHIP_ADD_CONTEXT_EVENT = 'mothership-add-context'

/**
 * Exactly one of the two fields is set, and each has its own consumer inside
 * the chat input: a singular `context` (browser/terminal selection actions) is
 * appended at the end of the draft with Electron-safe focus restoration, while
 * a `contexts` batch (file/table highlight-to-chat) is inserted at the caret.
 */
export type MothershipAddContextDetail =
  | {
      /** Single context appended by the browser/terminal selection actions. */
      context: ChatContext
      contexts?: never
    }
  | {
      context?: never
      /** The contexts to attach as chips, in insertion order. */
      contexts: ChatContext[]
    }

/**
 * Inserts one structured context into the mounted Mothership composer.
 *
 * Producers dispatch through this helper so browser/terminal selections use
 * the same context-token path as resources chosen from the input itself.
 *
 * @returns `true` when a mounted composer claimed the context.
 */
export function addMothershipContext(context: ChatContext): boolean {
  const consumed = dispatchClaimable<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    context,
  })
  logger.info('Dispatched mothership context event', { kind: context.kind, consumed })
  return consumed
}

/**
 * Dispatches a passive "add these context chips" request to a mounted Mothership
 * chat input — the highlight-to-chat action in the file and table viewers.
 *
 * Carries the whole batch in one event rather than one event per context: the
 * input resolves label collisions against its current chips, and that list only
 * refreshes on re-render, so consecutive synchronous dispatches would each see
 * the same stale list and drop colliding chips.
 *
 * @returns `true` when a mounted input consumed it, `false` when none was
 * listening — callers fall back to persisting a chip-only handoff (see
 * `MothershipHandoffStorage`) for the next chat mount.
 */
export function addMothershipContexts(contexts: ChatContext[]): boolean {
  if (contexts.length === 0) return false
  const consumed = dispatchClaimable<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    contexts,
  })
  logger.info('Dispatched mothership add-context event', { count: contexts.length, consumed })
  return consumed
}
