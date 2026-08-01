import { createLogger } from '@sim/logger'
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
export function sendMothershipMessage(message: string, contexts?: ChatContext[]): boolean {
  const trimmed = message.trim()
  if (!trimmed) {
    logger.warn('sendMothershipMessage called with empty message')
    return false
  }
  const consumed = dispatchClaimable<MothershipSendMessageDetail>(MOTHERSHIP_SEND_MESSAGE_EVENT, {
    message: trimmed,
    contexts,
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

export interface MothershipAddContextDetail {
  /** The context to attach as a chip in the input. */
  context: ChatContext
}

/**
 * Dispatches a passive "add this context chip" request to a mounted Mothership
 * chat input — the highlight-to-chat action in the file and table viewers.
 *
 * @returns `true` when a mounted input consumed it, `false` when none was
 * listening — callers fall back to persisting a chip-only
 * {@link MothershipHandoff} for the next chat mount.
 */
export function addMothershipContext(context: ChatContext): boolean {
  const consumed = dispatchClaimable<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    context,
  })
  logger.info('Dispatched mothership add-context event', { kind: context.kind, consumed })
  return consumed
}
