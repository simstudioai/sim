import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

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
 * Extract all custom tools from agent blocks in the workflow state
 */
export function extractCustomToolsFromWorkflowState(workflowState: any): CustomTool[] {
  const customToolsMap = new Map<string, CustomTool>()

  if (!workflowState?.blocks) {
    return []
  }

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    try {
      const blockData = block as any

      // Only process agent blocks
      if (!blockData || blockData.type !== 'agent') {
        continue
      }

      const subBlocks = blockData.subBlocks || {}
      const toolsSubBlock = subBlocks.tools

      if (!toolsSubBlock?.value) {
        continue
      }

      let tools = toolsSubBlock.value

      // Parse if it's a string
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

      // Extract custom tools
      for (const tool of tools) {
        if (
          tool &&
          typeof tool === 'object' &&
          tool.type === 'custom-tool' &&
          tool.title &&
          tool.schema?.function &&
          tool.code
        ) {
          // Use toolId if available, otherwise generate one from title
          const toolKey = tool.toolId || tool.title

          // Deduplicate by toolKey (if same tool appears in multiple blocks)
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
 * Persist custom tools to the database
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

  // Only persist if workspaceId is provided (new workspace-scoped tools)
  // Skip persistence for existing user-scoped tools to maintain backward compatibility
  if (!workspaceId) {
    logger.debug('Skipping custom tools persistence - no workspaceId provided (user-scoped tools)')
    return { saved: 0, errors: [] }
  }

  const errors: string[] = []
  let saved = 0

  try {
    await db.transaction(async (tx) => {
      for (const tool of customToolsList) {
        try {
          // Extract the base identifier (without 'custom_' prefix) for database storage
          // If toolId exists and has the prefix, strip it; otherwise use title as base
          let baseId: string
          if (tool.toolId) {
            baseId = tool.toolId.startsWith('custom_')
              ? tool.toolId.replace('custom_', '')
              : tool.toolId
          } else {
            // Use title as the base identifier (agent handler will add 'custom_' prefix)
            baseId = tool.title
          }

          const nowTime = new Date()

          // Check if tool already exists in this workspace
          const existingTool = await tx
            .select()
            .from(customTools)
            .where(and(eq(customTools.id, baseId), eq(customTools.workspaceId, workspaceId)))
            .limit(1)

          if (existingTool.length === 0) {
            // Create new tool
            await tx.insert(customTools).values({
              id: baseId,
              workspaceId,
              userId,
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              createdAt: nowTime,
              updatedAt: nowTime,
            })

            logger.info(`Created custom tool: ${tool.title}`, { toolId: baseId, workspaceId })
            saved++
          } else {
            // Update existing tool in workspace (workspace members can update)
            await tx
              .update(customTools)
              .set({
                title: tool.title,
                schema: tool.schema,
                code: tool.code,
                updatedAt: nowTime,
              })
              .where(and(eq(customTools.id, baseId), eq(customTools.workspaceId, workspaceId)))

            logger.info(`Updated custom tool: ${tool.title}`, { toolId: baseId, workspaceId })
            saved++
          }
        } catch (error) {
          const errorMsg = `Failed to persist tool ${tool.title}: ${error instanceof Error ? error.message : String(error)}`
          logger.error(errorMsg, { error })
          errors.push(errorMsg)
        }
      }
    })
  } catch (error) {
    const errorMsg = `Transaction failed while persisting custom tools: ${error instanceof Error ? error.message : String(error)}`
    logger.error(errorMsg, { error })
    errors.push(errorMsg)
  }

  return { saved, errors }
}

/**
 * Extract and persist custom tools from workflow state in one operation
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
