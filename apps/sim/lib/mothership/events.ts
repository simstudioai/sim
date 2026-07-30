import { createLogger } from '@sim/logger'
import type { ChatContext } from '@/stores/panel'

const logger = createLogger('MothershipEvents')

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
 * Chat" action) call this; consumers listen for
 * {@link MOTHERSHIP_SEND_MESSAGE_EVENT} on `window` and `preventDefault` to
 * claim it.
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
  const consumed = !window.dispatchEvent(
    new CustomEvent<MothershipSendMessageDetail>(MOTHERSHIP_SEND_MESSAGE_EVENT, {
      detail: { message: trimmed, contexts },
      cancelable: true,
    })
  )
  logger.info('Dispatched mothership message event', {
    messageLength: trimmed.length,
    consumed,
  })
  return consumed
}
