import { createLogger } from '@sim/logger'
import { upsertCustomTools } from '@/lib/workflows/custom-tools/operations'

const logger = createLogger('CustomToolsPersistence')

interface CustomTool {
  id?: string
  type: 'custom-tool'
  title: string
  toolId?: string
  schema: {
    function: {
      name?: string
      description: string
      parameters: Record<string, any>
    }
  }
  code: string
  usageControl?: string
}

/**
 * Stored tool format that may contain either reference or inline definition
 */
interface StoredCustomTool {
  type: string
  title?: string
  toolId?: string
  customToolId?: string
  schema?: any
  code?: string
  usageControl?: string
}

/**
 * Checks if a stored tool is a reference-only custom tool (no inline definition)
 */
function isCustomToolReference(tool: StoredCustomTool): boolean {
  return tool.type === 'custom-tool' && !!tool.customToolId && !tool.code
}

/**
 * Extract all custom tools from agent blocks in the workflow state
 *
 * @remarks
 * Only extracts tools with inline definitions (legacy format).
 * Reference-only tools (new format with customToolId) are skipped since they're already in the database.
 */
export function extractCustomToolsFromWorkflowState(workflowState: any): CustomTool[] {
  const customToolsMap = new Map<string, CustomTool>()

  if (!workflowState?.blocks) {
    return []
  }

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    try {
      const blockData = block as any

      if (!blockData || blockData.type !== 'agent') {
        continue
      }

      const subBlocks = blockData.subBlocks || {}
      const toolsSubBlock = subBlocks.tools

      if (!toolsSubBlock?.value) {
        continue
      }

      let tools = toolsSubBlock.value

      if (typeof tools === 'string') {
        try {
          tools = JSON.parse(tools)
        } catch (error) {
          logger.warn(`Failed to parse tools in block ${blockId}`, { error })
          continue
        }
      }

      if (!Array.isArray(tools)) {
        continue
      }

      for (const tool of tools) {
        if (!tool || typeof tool !== 'object' || tool.type !== 'custom-tool') {
          continue
        }

        // Skip reference-only tools - they're already in the database
        if (isCustomToolReference(tool)) {
          logger.debug(`Skipping reference-only custom tool: ${tool.title || tool.customToolId}`)
          continue
        }

        // Only persist tools with inline definitions (legacy format)
        if (tool.title && tool.schema?.function && tool.code) {
          const toolKey = tool.toolId || tool.title

          if (!customToolsMap.has(toolKey)) {
            customToolsMap.set(toolKey, tool as CustomTool)
          }
        }
      }
    } catch (error) {
      logger.error(`Error extracting custom tools from block ${blockId}`, { error })
    }
  }

  return Array.from(customToolsMap.values())
}

/**
 * Persist custom tools to the database using the upsert function
 * Creates new tools or updates existing ones
 */
export async function persistCustomToolsToDatabase(
  customToolsList: CustomTool[],
  workspaceId: string | null,
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  if (!customToolsList || customToolsList.length === 0) {
    return { saved: 0, errors: [] }
  }

  if (!workspaceId) {
    logger.debug('Skipping custom tools persistence - no workspaceId provided (user-scoped tools)')
    return { saved: 0, errors: [] }
  }

  const errors: string[] = []
  let saved = 0

  const validTools = customToolsList.filter((tool) => {
    if (!tool.schema?.function?.name) {
      logger.warn(`Skipping custom tool without function name: ${tool.title}`)
      return false
    }
    return true
  })

  if (validTools.length === 0) {
    return { saved: 0, errors: [] }
  }

  try {
    await upsertCustomTools({
      tools: validTools.map((tool) => ({
        id: tool.toolId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
      })),
      workspaceId,
      userId,
    })

    saved = validTools.length
    logger.info(`Persisted ${saved} custom tool(s)`, { workspaceId })
  } catch (error) {
    const errorMsg = `Failed to persist custom tools: ${error instanceof Error ? error.message : String(error)}`
    logger.error(errorMsg, { error })
    errors.push(errorMsg)
  }

  return { saved, errors }
}

/**
 * Extract and persist custom tools from workflow state
 */
export async function extractAndPersistCustomTools(
  workflowState: any,
  workspaceId: string | null,
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  const customToolsList = extractCustomToolsFromWorkflowState(workflowState)

  if (customToolsList.length === 0) {
    logger.debug('No custom tools found in workflow state')
    return { saved: 0, errors: [] }
  }

  logger.info(`Found ${customToolsList.length} custom tool(s) to persist`, {
    tools: customToolsList.map((t) => t.title),
    workspaceId,
  })

  return await persistCustomToolsToDatabase(customToolsList, workspaceId, userId)
}
