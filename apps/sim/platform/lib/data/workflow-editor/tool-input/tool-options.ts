import { createLogger } from '@sim/logger'
import type { McpToolSchema } from '@/lib/mcp/types'
import { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import type { StoredTool } from '@/lib/workflows/tool-input/types'
import type { BlockConfig } from '@/blocks/types'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import { getToolMetadata } from '@/tools/metadata'

const logger = createLogger('ToolInputOptions')

/** One operation a multi-operation tool block offers. */
interface ToolOperationOption {
  label: string
  id: string
}

/** The single field an advanced MCP server binding asks for. */
export const ADVANCED_MCP_SERVER_TOOL_SCHEMA: McpToolSchema = {
  type: 'object',
  properties: {
    serverId: {
      type: 'string',
      description: 'MCP server or managed connection ID, or upstream reference',
    },
  },
  required: ['serverId'],
}

/** The input schema a stored MCP tool carries, as the MCP validation reads it. */
export function mcpToolSchemaOf(tool: Pick<StoredTool, 'schema'>): McpToolSchema | undefined {
  return tool.schema as McpToolSchema | undefined
}

/** Whether a tool block offers more than one operation. */
export function hasMultipleOperations(block: BlockConfig | undefined): boolean {
  return (block?.tools?.access?.length || 0) > 1
}

/**
 * The operations a multi-operation tool block offers: its `operation` dropdown's options when it
 * declares one, otherwise one per tool it can call, named after the tool.
 */
export function getOperationOptions(block: BlockConfig | undefined): ToolOperationOption[] {
  if (!block || !block.tools?.access) return []

  const operationSubBlock = block.subBlocks.find((sb) => sb.id === OPERATION_SUBBLOCK_ID)
  if (
    operationSubBlock &&
    operationSubBlock.type === 'dropdown' &&
    Array.isArray(operationSubBlock.options)
  ) {
    return operationSubBlock.options.map((option) => ({ id: option.id, label: option.label }))
  }

  return block.tools.access.map((toolId) => {
    try {
      return { id: toolId, label: getToolMetadata(toolId)?.name || toolId }
    } catch (error) {
      logger.error('Error getting tool config', { toolId, error })
      return { id: toolId, label: toolId }
    }
  })
}

/** A custom tool's definition, as the editor modal and the card resolve it. */
interface ResolvedCustomTool {
  schema: StoredTool['schema'] | CustomToolDefinition['schema']
  code: string
  title: string
}

/**
 * Resolves a stored custom-tool entry to its definition: a `customToolId` reference loads from the
 * workspace's custom tools, and a legacy entry carries its schema and code inline.
 */
export function resolveCustomToolFromReference(
  storedTool: StoredTool,
  customToolsList: readonly CustomToolDefinition[]
): ResolvedCustomTool | null {
  if (storedTool.customToolId) {
    const customTool = customToolsList.find((t) => t.id === storedTool.customToolId)
    if (customTool) {
      return { schema: customTool.schema, code: customTool.code, title: customTool.title }
    }
    logger.warn('Custom tool not found by ID', { customToolId: storedTool.customToolId })
  }

  if (storedTool.schema && storedTool.code !== undefined) {
    return { schema: storedTool.schema, code: storedTool.code, title: storedTool.title || '' }
  }

  return null
}
