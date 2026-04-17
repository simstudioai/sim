import { createLogger } from '@sim/logger'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { toError } from '@/lib/core/utils/helpers'
import {
  deleteCustomTool,
  getCustomToolById,
  listCustomTools,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'

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
  workspaceId?: string
}

export async function executeManageCustomTool(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageCustomToolParams
  const operation = String(params.operation || '').toLowerCase() as ManageCustomToolOperation
  const workspaceId = params.workspaceId || context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_custom_tool requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const toolsForUser = await listCustomTools({
        userId: context.userId,
        workspaceId,
      })

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

      const resultTools = await upsertCustomTools({
        tools: [{ title, schema: params.schema, code: params.code }],
        workspaceId,
        userId: context.userId,
      })
      const created = resultTools.find((tool) => tool.title === title)

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: created?.id,
          title,
          message: `Created custom tool "${title}"`,
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

      const existing = await getCustomToolById({
        toolId: params.toolId,
        userId: context.userId,
        workspaceId,
      })
      if (!existing) {
        return { success: false, error: `Custom tool not found: ${params.toolId}` }
      }

      const mergedSchema = params.schema || (existing.schema as ManageCustomToolSchema)
      const mergedCode = params.code || existing.code
      const title = params.title || mergedSchema.function?.name || existing.title

      await upsertCustomTools({
        tools: [{ id: params.toolId, title, schema: mergedSchema, code: mergedCode }],
        workspaceId,
        userId: context.userId,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: params.toolId,
          title,
          message: `Updated custom tool "${title}"`,
        },
      }
    }

    if (operation === 'delete') {
      const toolIds: string[] = params.toolIds ?? (params.toolId ? [params.toolId] : [])
      if (toolIds.length === 0) {
        return { success: false, error: "'toolId' or 'toolIds' is required for operation 'delete'" }
      }

      const deleted: string[] = []
      const notFound: string[] = []

      for (const toolId of toolIds) {
        const result = await deleteCustomTool({
          toolId,
          userId: context.userId,
          workspaceId,
        })
        if (result) {
          deleted.push(toolId)
        } else {
          notFound.push(toolId)
        }
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
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage custom tool',
    }
  }
}
