import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowApplier')

export type EditorFormat = 'json' | 'yaml'

export interface ApplyResult {
  success: boolean
  errors: string[]
  warnings: string[]
  appliedOperations: number
}

/**
 * Apply workflow changes by using the new consolidated YAML endpoint
 * for YAML format or direct state replacement for JSON
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

    logger.info('Starting applyWorkflowDiff', {
      format,
      activeWorkflowId,
      contentLength: content.length,
    })

    if (format === 'yaml') {
      logger.info('Processing YAML format - calling consolidated YAML endpoint')

      try {
        // Use the new consolidated YAML endpoint
        const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yamlContent: content,
            source: 'editor',
            applyAutoLayout: true,
            createCheckpoint: false,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Failed to save YAML workflow:', errorData)
          return {
            success: false,
            errors: [errorData.message || `HTTP ${response.status}: ${response.statusText}`],
            warnings: [],
            appliedOperations: 0,
          }
        }

        const result = await response.json()

        logger.info('YAML workflow save completed', {
          success: result.success,
          errors: result.errors || [],
          warnings: result.warnings || [],
        })

        // Calculate applied operations (blocks + edges)
        const appliedOperations = (result.data?.blocksCount || 0) + (result.data?.edgesCount || 0)

        return {
          success: result.success,
          errors: result.errors || [],
          warnings: result.warnings || [],
          appliedOperations,
        }
      } catch (error) {
        logger.error('YAML processing failed:', error)
        return {
          success: false,
          errors: [
            `YAML processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
          warnings: [],
          appliedOperations: 0,
        }
      }
    }

    if (format === 'json') {
      logger.info('Processing JSON format - direct state replacement')

      try {
        const workflowState = JSON.parse(content)

        // Validate that this looks like a workflow state
        if (!workflowState.blocks || !workflowState.edges) {
          return {
            success: false,
            errors: ['Invalid workflow state: missing blocks or edges'],
            warnings: [],
            appliedOperations: 0,
          }
        }

        // Use the existing workflow state endpoint for JSON
        const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...workflowState,
            lastSaved: Date.now(),
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Failed to save JSON workflow state:', errorData)
          return {
            success: false,
            errors: [errorData.error || `HTTP ${response.status}: ${response.statusText}`],
            warnings: [],
            appliedOperations: 0,
          }
        }

        const result = await response.json()

        logger.info('JSON workflow state save completed', {
          success: result.success,
          blocksCount: result.blocksCount,
          edgesCount: result.edgesCount,
        })

        // Auto layout would need to be called separately for JSON format if needed
        // JSON format doesn't automatically apply auto layout like YAML does

        // Calculate applied operations
        const appliedOperations = (result.blocksCount || 0) + (result.edgesCount || 0)

        return {
          success: true,
          errors: [],
          warnings: [],
          appliedOperations,
        }
      } catch (error) {
        logger.error('JSON processing failed:', error)
        return {
          success: false,
          errors: [
            `JSON processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
          warnings: [],
          appliedOperations: 0,
        }
      }
    }

    return {
      success: false,
      errors: [`Unsupported format: ${format}`],
      warnings: [],
      appliedOperations: 0,
    }
  } catch (error) {
    logger.error('applyWorkflowDiff failed:', error)
    return {
      success: false,
      errors: [
        `Failed to apply workflow changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ],
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
