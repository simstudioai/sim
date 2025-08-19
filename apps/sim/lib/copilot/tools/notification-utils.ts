/**
 * Tool Notification Utilities
 * Handles notifications and state messages for tools
 */

import { toolRegistry } from '@/lib/copilot/tools/registry'
import type { NotificationStatus, ToolState } from '@/lib/copilot/tools/types'

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
  // Previously called the confirm API (Redis-backed). Now a no-op with optional console log.
  const metadata = toolRegistry.getToolMetadata(toolId)
  const status = STATE_MAPPINGS[toolState]
  const message = metadata?.stateMessages?.[status as NotificationStatus]
  // Intentionally do nothing server-side; client tools update UI state locally.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[CopilotNotify] (noop)', {
      toolId,
      toolName,
      toolState,
      status,
      message,
      executionStartTime,
    })
  }
}
