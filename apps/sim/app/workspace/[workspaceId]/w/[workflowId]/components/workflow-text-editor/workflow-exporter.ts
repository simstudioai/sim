import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowJsonStore } from '@/stores/workflows/json/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { EditorFormat } from './workflow-text-editor'

const logger = createLogger('WorkflowExporter')

/**
 * Get subblock values organized by block for the exporter
 */
function getSubBlockValues() {
  const workflowState = useWorkflowStore.getState()
  const subBlockStore = useSubBlockStore.getState()

  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(workflowState.blocks).forEach(([blockId]) => {
    subBlockValues[blockId] = {}
    // Get all subblock values for this block
    Object.keys(workflowState.blocks[blockId].subBlocks || {}).forEach((subBlockId) => {
      const value = subBlockStore.getValue(blockId, subBlockId)
      if (value !== undefined) {
        subBlockValues[blockId][subBlockId] = value
      }
    })
  })

  return subBlockValues
}

/**
 * Generate full workflow data including metadata and state
 */
export function generateFullWorkflowData() {
  const workflowState = useWorkflowStore.getState()
  const { workflows, activeWorkflowId } = useWorkflowRegistry.getState()

  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

  if (!currentWorkflow || !activeWorkflowId) {
    throw new Error('No active workflow found')
  }

  const subBlockValues = getSubBlockValues()

  return {
    workflow: {
      id: activeWorkflowId,
      name: currentWorkflow.name,
      description: currentWorkflow.description,
      color: currentWorkflow.color,
      workspaceId: currentWorkflow.workspaceId,
      folderId: currentWorkflow.folderId,
    },
    state: {
      blocks: workflowState.blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
    },
    subBlockValues,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  }
}

/**
 * Export workflow in the specified format
 */
export async function exportWorkflow(format: EditorFormat): Promise<string> {
  try {
    // Always use JSON format now
    const { getJson } = useWorkflowJsonStore.getState()
    return await getJson()
  } catch (error) {
    logger.error(`Failed to export workflow:`, error)
    throw error
  }
}

/**
 * Parse workflow content based on format
 */
export async function parseWorkflowContent(content: string, format: EditorFormat): Promise<any> {
  return JSON.parse(content)
}

/**
 * Convert between YAML and JSON formats
 */
export function convertBetweenFormats(
  content: string,
  fromFormat: EditorFormat,
  toFormat: EditorFormat
): string {
  // Always JSON now
  return content
}
