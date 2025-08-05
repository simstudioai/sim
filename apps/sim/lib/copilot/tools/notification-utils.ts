/**
 * Tool Notification Utilities
 * Handles notifications and state messages for tools
 */

import { toolRegistry } from '@/lib/copilot/tools/registry'
import type { NotificationStatus, ToolState } from '@/lib/copilot/tools/types'

/**
 * Send a notification for a tool state change
 * @param toolId - The unique identifier for the tool call
 * @param toolName - The name of the tool (e.g., 'set_environment_variables')
 * @param toolState - The current state of the tool
 */
/**
 * Maps tool states to notification statuses
 */
const STATE_MAPPINGS: Partial<Record<ToolState, NotificationStatus>> = {
  success: 'success',
  errored: 'error',
  accepted: 'accepted',
  rejected: 'rejected',
  background: 'background',
}

const SERVER_TOOL_MAPPINGS: Partial<Record<ToolState, NotificationStatus>> = {
  accepted: 'accepted',
  rejected: 'rejected',
  background: 'background',
}

export async function notifyServerTool(
  toolId: string,
  toolName: string,
  toolState: ToolState,
  executionStartTime?: string
): Promise<void> {
  const notificationStatus = SERVER_TOOL_MAPPINGS[toolState]
  if (!notificationStatus) {
    throw new Error(`Invalid tool state: ${toolState}`)
  }
  await notify(toolId, toolName, toolState, executionStartTime)
}

export async function notify(
  toolId: string,
  toolName: string,
  toolState: ToolState,
  executionStartTime?: string
): Promise<void> {
  // toolState must be in STATE_MAPPINGS
  const notificationStatus = STATE_MAPPINGS[toolState]
  if (!notificationStatus) {
    throw new Error(`Invalid tool state: ${toolState}`)
  }

  // Get the state message from tool metadata
  const metadata = toolRegistry.getToolMetadata(toolId)
  let stateMessage = metadata?.stateMessages?.[notificationStatus]

  // If no message from metadata, provide default messages
  if (!stateMessage) {
    if (notificationStatus === 'background') {
      const timeInfo = executionStartTime ? ` Started at: ${executionStartTime}.` : ''
      stateMessage = `The user has moved tool execution to the background and it is not complete, it will run asynchronously.${timeInfo}`
    } else {
      stateMessage = ''
    }
  }

  // Call backend confirm route
  await fetch('/api/copilot/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toolCallId: toolId,
      status: notificationStatus,
      message: stateMessage,
    }),
  })
}
