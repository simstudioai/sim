/**
 * Set Context Server Tool
 *
 * Allows headless mode sessions to dynamically set the workflow context.
 * When called, this tool validates that the user has access to the specified
 * workflow and returns the resolved context (including workspaceId).
 *
 * Go copilot should update its internal session state with the returned context
 * and include it in subsequent tool_call events.
 */

import { createLogger } from '@sim/logger'
import { verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('SetContextServerTool')

export interface SetContextParams {
  /** The workflow ID to set as the current context */
  workflowId: string
}

export interface SetContextResult {
  success: boolean
  /** The resolved execution context - Go should store this and include in tool_call events */
  executionContext: {
    workflowId: string
    workspaceId?: string
    userId: string
  }
  message: string
}

export const setContextServerTool: BaseServerTool<SetContextParams, SetContextResult> = {
  name: 'set_context',

  async execute(params: SetContextParams, context?: { userId: string }): Promise<SetContextResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to set context - no authenticated user')
      throw new Error('Authentication required')
    }

    const { workflowId } = params

    if (!workflowId) {
      throw new Error('workflowId is required')
    }

    logger.info('Setting execution context', {
      workflowId,
      userId: context.userId,
    })

    // Verify the user has access to this workflow
    const { hasAccess, workspaceId } = await verifyWorkflowAccess(context.userId, workflowId)

    if (!hasAccess) {
      logger.warn('User does not have access to workflow', {
        workflowId,
        userId: context.userId,
      })
      throw new Error(`Access denied to workflow ${workflowId}`)
    }

    logger.info('Context set successfully', {
      workflowId,
      workspaceId,
      userId: context.userId,
    })

    return {
      success: true,
      executionContext: {
        workflowId,
        workspaceId,
        userId: context.userId,
      },
      message: `Context set to workflow ${workflowId}${workspaceId ? ` (workspace: ${workspaceId})` : ''}`,
    }
  },
}
