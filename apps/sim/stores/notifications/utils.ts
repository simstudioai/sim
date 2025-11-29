import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { usePanelStore } from '@/stores/panel/store'

const logger = createLogger('NotificationUtils')

/**
 * Opens the copilot panel and directly sends the message.
 *
 * @param message - The message to send in the copilot.
 */
export function openCopilotWithMessage(message: string): void {
  try {
    const trimmedMessage = message.trim()

    // Avoid sending empty/whitespace messages
    if (!trimmedMessage) {
      logger.warn('openCopilotWithMessage called with empty message')
      return
    }

    // Switch to copilot tab
    const panelStore = usePanelStore.getState()
    panelStore.setActiveTab('copilot')

    // Read current copilot state
    const copilotStore = useCopilotStore.getState()

    // If workflowId is not set, sendMessage will early-return; surface that explicitly
    if (!copilotStore.workflowId) {
      logger.warn('Copilot workflowId is not set, skipping sendMessage', {
        messageLength: trimmedMessage.length,
      })
      return
    }

    // Avoid overlapping sends; let existing stream finish/abort first
    if (copilotStore.isSendingMessage) {
      logger.warn('Copilot is already sending a message, skipping new send', {
        messageLength: trimmedMessage.length,
      })
      return
    }

    const messageWithInstructions = `${trimmedMessage}\n\nPlease fix this.`

    void copilotStore.sendMessage(messageWithInstructions, { stream: true }).catch((error) => {
      logger.error('Failed to send message to copilot', { error })
    })

    logger.info('Opened copilot and sent message', { messageLength: trimmedMessage.length })
  } catch (error) {
    logger.error('Failed to open copilot with message', { error })
  }
}
