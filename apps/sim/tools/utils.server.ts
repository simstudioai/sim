import { createLogger } from '@sim/logger'
import { customToolSchemaSchema } from '@/lib/api/contracts/tools/custom'
import {
  readAvailableCustomToolByIdOrTitleAsCopilot,
  readAvailableCustomToolByIdOrTitleAsExecutor,
} from '@/lib/internal/custom-tools/read-available-by-id-or-title'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { isCustomTool } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import { tools } from '@/tools/registry'
import type { ExecutableToolConfig } from '@/tools/types'
import {
  createCustomToolRequestBody,
  createParamSchema,
  createToolConfig,
  resolveToolId,
} from '@/tools/utils'

const logger = createLogger('ToolsUtils')

export interface GetToolAsyncContext {
  executionContext?: ExecutionContext
  operationContext?: InternalToolOperationContext
  signal?: AbortSignal
}

type CustomToolRow = NonNullable<
  Awaited<ReturnType<typeof readAvailableCustomToolByIdOrTitleAsExecutor>>
>

function toCustomToolDefinition(customTool: CustomToolRow): CustomToolDefinition | null {
  const parsedSchema = customToolSchemaSchema.safeParse(customTool.schema)
  if (!parsedSchema.success) {
    logger.error(`Invalid custom tool schema: ${customTool.id}`, {
      issues: parsedSchema.error.issues,
    })
    return null
  }

  return {
    id: customTool.id,
    workspaceId: customTool.workspaceId,
    userId: customTool.userId,
    title: customTool.title,
    schema: parsedSchema.data,
    code: customTool.code,
    createdAt: customTool.createdAt.toISOString(),
    updatedAt: customTool.updatedAt?.toISOString(),
  }
}

// Get a tool by its ID asynchronously (supports server-side)
export async function getToolAsync(
  toolId: string,
  context: GetToolAsyncContext = {}
): Promise<ExecutableToolConfig | undefined> {
  const builtInTool = tools[resolveToolId(toolId)]
  if (builtInTool) return builtInTool

  if (isCustomTool(toolId)) {
    return fetchCustomToolFromDB(toolId, context)
  }

  return undefined
}

async function fetchCustomToolFromDB(
  customToolId: string,
  context: GetToolAsyncContext
): Promise<ExecutableToolConfig | undefined> {
  const { executionContext, operationContext, signal } = context
  const identifier = customToolId.replace('custom_', '')

  if (
    (!executionContext ||
      (!executionContext.userId && !executionContext.principal?.executionMetadata)) &&
    !operationContext?.copilotToolExecution
  ) {
    throw new Error(`Cannot fetch custom tool without userId: ${identifier}`)
  }

  try {
    const customTool = executionContext
      ? await readAvailableCustomToolByIdOrTitleAsExecutor({
          context: executionContext,
          identifier,
          lookup: 'id_or_title',
        })
      : await readAvailableCustomToolByIdOrTitleAsCopilot({
          context: operationContext!,
          identifier,
          lookup: 'id_or_title',
          signal,
        })

    if (!customTool) {
      logger.error(`Custom tool not found: ${identifier}`)
      return undefined
    }

    const customToolDefinition = toCustomToolDefinition(customTool)
    if (!customToolDefinition) {
      return undefined
    }

    const toolConfig = createToolConfig(customToolDefinition, customToolId)

    return {
      ...toolConfig,
      params: createParamSchema(customTool),
      operation: {
        input: createCustomToolRequestBody(
          customTool,
          false,
          executionContext?.workflowId ?? operationContext?.workflowId
        ),
      },
    }
  } catch (error) {
    logger.error(`Error fetching custom tool ${identifier} from DB:`, error)
    return undefined
  }
}
