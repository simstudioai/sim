import { createLogger } from '@sim/logger'

const logger = createLogger('MothershipEvents')

/**
 * Custom-event name used to send a user message to the Mothership chat.
 * The mothership host components (workspace home, workflow panel) listen
 * for this event and call their `sendMessage` on receipt.
 */
export const MOTHERSHIP_SEND_MESSAGE_EVENT = 'mothership-send-message'

export interface MothershipSendMessageDetail {
  message: string
}

/**
 * Dispatches a message to the Mothership chat. Producers (terminal block
 * errors, console copilot actions, toast actions) call this; consumers
 * listen for {@link MOTHERSHIP_SEND_MESSAGE_EVENT} on `window`.
 */
export function sendMothershipMessage(message: string): void {
  const trimmed = message.trim()
  if (!trimmed) {
    logger.warn('sendMothershipMessage called with empty message')
    return
  }
  window.dispatchEvent(
    new CustomEvent<MothershipSendMessageDetail>(MOTHERSHIP_SEND_MESSAGE_EVENT, {
      detail: { message: trimmed },
    })
  )
  logger.info('Dispatched mothership message event', { messageLength: trimmed.length })
}
