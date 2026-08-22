import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeCopilotCustomToolUseCase } from '@/lib/copilot/application/execute-custom-tool-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  deleteAvailableCustomToolUseCase,
  listAvailableCustomToolsUseCase,
  saveWorkspaceCustomToolUseCase,
  updateAvailableCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CopilotToolExecutor')

type ManageCustomToolOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageCustomToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

interface ManageCustomToolParams {
  operation?: string
  toolId?: string
  toolIds?: string[]
  schema?: ManageCustomToolSchema
  code?: string
  title?: string
}

export async function executeManageCustomTool(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageCustomToolParams
  const operation = String(params.operation || '').toLowerCase() as ManageCustomToolOperation
  /**
   * Server-set context only. A model-supplied `params.workspaceId` used to win
   * here, while the permission gate above is resolved for the CONTEXT
   * workspace — so a caller could name another workspace and have it
   * authorized against their own. `upsertCustomTools` does no authz of its own
   * (it only scopes queries by the id it is handed), so nothing downstream
   * caught it. Matches manage_mcp_connection and manage_skill.
   */
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  try {
    if (operation === 'list') {
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      const { tools: toolsForUser } = await executeCopilotCustomToolUseCase(
        context,
        listAvailableCustomToolsUseCase,
        { workspaceId }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          tools: toolsForUser,
          count: toolsForUser.length,
        },
      }
    }

    if (operation === 'add') {
      if (!workspaceId) {
        return {
          success: false,
          error: "workspaceId is required for operation 'add'",
        }
      }
      if (!params.schema || !params.code) {
        return {
          success: false,
          error: "Both 'schema' and 'code' are required for operation 'add'",
        }
      }

      const title = params.title || params.schema.function?.name
      if (!title) {
        return { success: false, error: "Missing tool title or schema.function.name for 'add'" }
      }

      const { tool: created } = await executeCopilotCustomToolUseCase(
        context,
        saveWorkspaceCustomToolUseCase,
        {
          title,
          schema: params.schema,
          code: params.code,
          source: 'tool_input',
          workspaceId,
        }
      )
      captureServerEvent(
        context.userId,
        'custom_tool_saved',
        {
          tool_id: created.id,
          workspace_id: workspaceId,
          tool_name: created.title,
          source: 'tool_input',
        },
        { groups: { workspace: workspaceId } }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: created.id,
          title: created.title,
          message: `Created custom tool "${created.title}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!workspaceId) {
        return {
          success: false,
          error: "workspaceId is required for operation 'edit'",
        }
      }
      if (!params.toolId) {
        return { success: false, error: "'toolId' is required for operation 'edit'" }
      }
      if (!params.schema && !params.code) {
        return {
          success: false,
          error: "At least one of 'schema' or 'code' is required for operation 'edit'",
        }
      }

      const { tool } = await executeCopilotCustomToolUseCase(
        context,
        updateAvailableCustomToolUseCase,
        {
          workspaceId,
          toolId: params.toolId,
          title: params.title || params.schema?.function?.name,
          schema: params.schema,
          code: params.code,
          source: 'tool_input',
        }
      )
      captureServerEvent(
        context.userId,
        'custom_tool_saved',
        {
          tool_id: tool.id,
          workspace_id: workspaceId,
          tool_name: tool.title,
          source: 'tool_input',
        },
        { groups: { workspace: workspaceId } }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: tool.id,
          title: tool.title,
          message: `Updated custom tool "${tool.title}"`,
        },
      }
    }

    if (operation === 'delete') {
      const toolIds: string[] = params.toolIds ?? (params.toolId ? [params.toolId] : [])
      if (toolIds.length === 0) {
        return { success: false, error: "'toolId' or 'toolIds' is required for operation 'delete'" }
      }
      if (!workspaceId) return { success: false, error: 'workspaceId is required' }
      const deleted: string[] = []
      const notFound: string[] = []

      for (const toolId of toolIds) {
        try {
          await executeCopilotCustomToolUseCase(context, deleteAvailableCustomToolUseCase, {
            toolId,
            workspaceId,
            source: 'tool_input',
          })
          deleted.push(toolId)
        } catch (error) {
          const classified = asOrchestrationError(error)
          if (classified?.code === 'not_found') {
            notFound.push(toolId)
            continue
          }
          throw error
        }
      }

      for (const toolId of deleted) {
        captureServerEvent(
          context.userId,
          'custom_tool_deleted',
          { tool_id: toolId, workspace_id: workspaceId, source: 'tool_input' },
          { groups: { workspace: workspaceId } }
        )
      }

      return {
        success: deleted.length > 0,
        output: {
          success: deleted.length > 0,
          operation,
          deleted,
          notFound,
          message: `Deleted ${deleted.length} custom tool(s)`,
        },
      }
    }

    return {
      success: false,
      error: `Unsupported operation for manage_custom_tool: ${operation}`,
    }
  } catch (error) {
    logger.error(
      context.messageId
        ? `manage_custom_tool execution failed [messageId:${context.messageId}]`
        : 'manage_custom_tool execution failed',
      {
        operation,
        workspaceId,
        userId: context.userId,
        error: toError(error).message,
      }
    )
    const classified = asOrchestrationError(error)
    return {
      success: false,
      error:
        classified && classified.code !== 'internal'
          ? classified.message
          : `The ${operation ?? 'custom tool'} operation failed inside Sim. The write may or may not have landed — run operation "list" to check current state before retrying.`,
    }
  }
}
