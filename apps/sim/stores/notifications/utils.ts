import { createLogger } from '@sim/logger'

const logger = createLogger('NotificationUtils')

/**
 * Dispatches a message to the mothership chat via a custom window event.
 * The mothership `Home` component listens for this event and calls `sendMessage`.
 */
export function sendMothershipMessage(message: string): void {
  const trimmed = message.trim()
  if (!trimmed) {
    logger.warn('sendMothershipMessage called with empty message')
    return
  }
  window.dispatchEvent(new CustomEvent('mothership-send-message', { detail: { message: trimmed } }))
  logger.info('Dispatched mothership message event', { messageLength: trimmed.length })
}
