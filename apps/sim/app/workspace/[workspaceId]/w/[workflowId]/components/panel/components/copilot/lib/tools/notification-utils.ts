/**
 * Tool Notification Utilities
 * Handles notifications and state messages for tools
 */

import { toolRegistry } from './registry'
import type { NotificationStatus, ToolState } from './types'

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
  toolState: ToolState
): Promise<void> {
  const notificationStatus = SERVER_TOOL_MAPPINGS[toolState]
  if (!notificationStatus) {
    throw new Error(`Invalid tool state: ${toolState}`)
  }
  await notify(toolId, toolName, toolState)
}

export async function notify(
  toolId: string,
  toolName: string,
  toolState: ToolState
): Promise<void> {
  // toolState must be in STATE_MAPPINGS
  const notificationStatus = STATE_MAPPINGS[toolState]
  if (!notificationStatus) {
    throw new Error(`Invalid tool state: ${toolState}`)
  }

  // Get the state message from tool metadata
  const metadata = toolRegistry.getToolMetadata(toolId)
  let stateMessage = metadata?.stateMessages?.[notificationStatus]
  if (!stateMessage) {
    stateMessage = ''
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
      toolName,
      toolState,
      stateMessage,
    }),
  })
}
