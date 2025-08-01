import { dump as yamlDump } from 'js-yaml'
import { createLogger } from '@/lib/logs/console/logger'
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
    if (format === 'yaml') {
      // Use the YAML service for conversion
      const workflowState = useWorkflowStore.getState()
      const subBlockValues = getSubBlockValues()

      // Call the API route to generate YAML (server has access to API key)
      const response = await fetch('/api/workflows/yaml/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowState,
          subBlockValues,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Failed to generate YAML: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success || !result.yaml) {
        throw new Error(result.error || 'Failed to generate YAML')
      }
      return result.yaml
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
export async function parseWorkflowContent(content: string, format: EditorFormat): Promise<any> {
  if (format === 'yaml') {
    // For now, we'll parse YAML on the server when it's being saved
    // The workflow-text-editor should handle the actual conversion
    throw new Error('YAML parsing should be handled by the server when saving the workflow')
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
