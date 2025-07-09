import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { importWorkflowFromYaml } from '@/stores/workflows/yaml/importer'
import type { EditorFormat } from './workflow-text-editor'

const logger = createLogger('WorkflowApplier')

export interface ApplyResult {
  success: boolean
  errors: string[]
  warnings: string[]
  appliedOperations: number
}

/**
 * Apply workflow changes by using the existing importer for YAML
 * or direct state replacement for JSON
 */
export async function applyWorkflowDiff(
  content: string,
  format: EditorFormat
): Promise<ApplyResult> {
  try {
    const { activeWorkflowId } = useWorkflowRegistry.getState()

    if (!activeWorkflowId) {
      return {
        success: false,
        errors: ['No active workflow found'],
        warnings: [],
        appliedOperations: 0,
      }
    }

    if (format === 'yaml') {
      // Use the existing YAML importer which handles ID mapping and complete state replacement
      const workflowActions = {
        addBlock: () => {}, // Not used in this path
        addEdge: () => {}, // Not used in this path
        applyAutoLayout: () => {
          // Trigger auto layout after import
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('trigger-auto-layout'))
          }, 100)
        },
        setSubBlockValue: () => {}, // Not used in this path
        getExistingBlocks: () => useWorkflowStore.getState().blocks,
      }

      const result = await importWorkflowFromYaml(content, workflowActions)

      return {
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
        appliedOperations: result.success ? 1 : 0, // One complete import operation
      }
    }
    // Handle JSON format - complete state replacement
    let parsedData: any
    try {
      parsedData = JSON.parse(content)
    } catch (error) {
      return {
        success: false,
        errors: [`Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`],
        warnings: [],
        appliedOperations: 0,
      }
    }

    // Validate JSON structure
    if (!parsedData.state || !parsedData.state.blocks) {
      return {
        success: false,
        errors: ['Invalid JSON structure: missing state.blocks'],
        warnings: [],
        appliedOperations: 0,
      }
    }

    // Extract workflow state and subblock values
    const newWorkflowState = {
      blocks: parsedData.state.blocks,
      edges: parsedData.state.edges || [],
      loops: parsedData.state.loops || {},
      parallels: parsedData.state.parallels || {},
      lastSaved: Date.now(),
      isDeployed: parsedData.state.isDeployed || false,
      deployedAt: parsedData.state.deployedAt,
      deploymentStatuses: parsedData.state.deploymentStatuses || {},
      hasActiveSchedule: parsedData.state.hasActiveSchedule || false,
      hasActiveWebhook: parsedData.state.hasActiveWebhook || false,
    }

    // Update local workflow state
    useWorkflowStore.setState(newWorkflowState)

    // Update subblock values if provided
    if (parsedData.subBlockValues) {
      useSubBlockStore.setState((state: any) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: parsedData.subBlockValues,
        },
      }))
    }

    // Update workflow metadata if provided
    if (parsedData.workflow) {
      const { updateWorkflow } = useWorkflowRegistry.getState()
      const metadata = parsedData.workflow

      updateWorkflow(activeWorkflowId, {
        name: metadata.name,
        description: metadata.description,
        color: metadata.color,
      })
    }

    // Save to database
    try {
      const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newWorkflowState),
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Failed to save workflow state:', errorData.error)
        return {
          success: false,
          errors: [`Database save failed: ${errorData.error || 'Unknown error'}`],
          warnings: [],
          appliedOperations: 0,
        }
      }
    } catch (error) {
      logger.error('Failed to save workflow state:', error)
      return {
        success: false,
        errors: [
          `Failed to save workflow state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
        warnings: [],
        appliedOperations: 0,
      }
    }

    // Trigger auto layout
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('trigger-auto-layout'))
    }, 100)

    return {
      success: true,
      errors: [],
      warnings: [],
      appliedOperations: 1, // One complete state replacement
    }
  } catch (error) {
    logger.error('Failed to apply workflow changes:', error)
    return {
      success: false,
      errors: [`Apply failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      warnings: [],
      appliedOperations: 0,
    }
  }
}

/**
 * Preview what changes would be applied (simplified for the new approach)
 */
export function previewWorkflowDiff(
  content: string,
  format: EditorFormat
): {
  summary: string
  operations: Array<{
    type: string
    description: string
  }>
} {
  try {
    if (format === 'yaml') {
      // For YAML, we would do a complete import
      return {
        summary: 'Complete workflow replacement from YAML',
        operations: [
          {
            type: 'complete_replacement',
            description: 'Replace entire workflow with YAML content',
          },
        ],
      }
    }
    // For JSON, we would do a complete state replacement
    let parsedData: any
    try {
      parsedData = JSON.parse(content)
    } catch (error) {
      return {
        summary: 'Invalid JSON format',
        operations: [],
      }
    }

    const operations = []

    if (parsedData.state?.blocks) {
      const blockCount = Object.keys(parsedData.state.blocks).length
      operations.push({
        type: 'replace_blocks',
        description: `Replace workflow with ${blockCount} blocks`,
      })
    }

    if (parsedData.state?.edges) {
      const edgeCount = parsedData.state.edges.length
      operations.push({
        type: 'replace_edges',
        description: `Replace connections with ${edgeCount} edges`,
      })
    }

    if (parsedData.subBlockValues) {
      operations.push({
        type: 'replace_values',
        description: 'Replace all input values',
      })
    }

    if (parsedData.workflow) {
      operations.push({
        type: 'update_metadata',
        description: 'Update workflow metadata',
      })
    }

    return {
      summary: 'Complete workflow state replacement from JSON',
      operations,
    }
  } catch (error) {
    return {
      summary: 'Error analyzing changes',
      operations: [],
    }
  }
}
