import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import { createLogger } from '@/lib/logs/console/logger'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
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
export function exportWorkflow(format: EditorFormat): string {
  try {
    if (format === 'yaml') {
      // Use the existing YAML generator for condensed format
      const workflowState = useWorkflowStore.getState()
      const subBlockValues = getSubBlockValues()
      return generateWorkflowYaml(workflowState, subBlockValues)
    }
    // Generate full JSON format
    const fullData = generateFullWorkflowData()
    return JSON.stringify(fullData, null, 2)
  } catch (error) {
    logger.error(`Failed to export workflow as ${format}:`, error)
    throw error
  }
}

/**
 * Parse workflow content based on format
 */
export function parseWorkflowContent(content: string, format: EditorFormat): any {
  if (format === 'yaml') {
    return yamlLoad(content)
  }
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
  if (fromFormat === toFormat) return content

  try {
    const parsed = parseWorkflowContent(content, fromFormat)

    if (toFormat === 'yaml') {
      return yamlDump(parsed, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      })
    }
    return JSON.stringify(parsed, null, 2)
  } catch (error) {
    logger.error(`Failed to convert from ${fromFormat} to ${toFormat}:`, error)
    throw error
  }
}
