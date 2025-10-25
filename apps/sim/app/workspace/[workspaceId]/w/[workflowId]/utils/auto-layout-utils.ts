import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('AutoLayoutUtils')

/**
 * Auto layout options interface
 */
export interface AutoLayoutOptions {
  strategy?: 'smart' | 'hierarchical' | 'layered' | 'force-directed'
  direction?: 'horizontal' | 'vertical' | 'auto'
  spacing?: {
    horizontal?: number
    vertical?: number
    layer?: number
  }
  alignment?: 'start' | 'center' | 'end'
  padding?: {
    x?: number
    y?: number
  }
}

/**
 * Default auto layout options
 */
const DEFAULT_AUTO_LAYOUT_OPTIONS = {
  strategy: 'smart' as const,
  direction: 'auto' as const,
  spacing: {
    horizontal: 550,
    vertical: 200,
    layer: 550,
  },
  alignment: 'center' as const,
  padding: {
    x: 150,
    y: 150,
  },
}

/**
 * Apply auto layout and update store
 * Standalone utility for use outside React context (event handlers, tools, etc.)
 */
export async function applyAutoLayoutAndUpdateStore(
  workflowId: string,
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const workflowStore = useWorkflowStore.getState()
    const { blocks, edges, loops = {}, parallels = {} } = workflowStore

    logger.info('Auto layout store data:', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
      loopCount: Object.keys(loops).length,
      parallelCount: Object.keys(parallels).length,
    })

    if (Object.keys(blocks).length === 0) {
      logger.warn('No blocks to layout', { workflowId })
      return { success: false, error: 'No blocks to layout' }
    }

    // Merge with default options
    const layoutOptions = {
      strategy: options.strategy || DEFAULT_AUTO_LAYOUT_OPTIONS.strategy,
      direction: options.direction || DEFAULT_AUTO_LAYOUT_OPTIONS.direction,
      spacing: {
        horizontal: options.spacing?.horizontal || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing.horizontal,
        vertical: options.spacing?.vertical || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing.vertical,
        layer: options.spacing?.layer || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing.layer,
      },
      alignment: options.alignment || DEFAULT_AUTO_LAYOUT_OPTIONS.alignment,
      padding: {
        x: options.padding?.x || DEFAULT_AUTO_LAYOUT_OPTIONS.padding.x,
        y: options.padding?.y || DEFAULT_AUTO_LAYOUT_OPTIONS.padding.y,
      },
    }

    // Call the autolayout API route
    const response = await fetch(`/api/workflows/${workflowId}/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...layoutOptions,
        blocks,
        edges,
        loops,
        parallels,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const errorMessage = errorData?.error || `Auto layout failed: ${response.statusText}`
      logger.error('Auto layout API call failed:', {
        status: response.status,
        error: errorMessage,
      })
      return { success: false, error: errorMessage }
    }

    const result = await response.json()

    if (!result.success) {
      const errorMessage = result.error || 'Auto layout failed'
      logger.error('Auto layout failed:', { error: errorMessage })
      return { success: false, error: errorMessage }
    }

    // Update workflow store immediately with new positions
    const newWorkflowState = {
      ...workflowStore.getWorkflowState(),
      blocks: result.data?.layoutedBlocks || blocks,
      lastSaved: Date.now(),
    }

    useWorkflowStore.setState(newWorkflowState)

    logger.info('Successfully updated workflow store with auto layout', { workflowId })

    // Persist the changes to the database optimistically
    try {
      useWorkflowStore.getState().updateLastSaved()

      const { deploymentStatuses, needsRedeployment, dragStartPosition, ...stateToSave } =
        newWorkflowState

      const cleanedWorkflowState = {
        ...stateToSave,
        deployedAt: stateToSave.deployedAt ? new Date(stateToSave.deployedAt) : undefined,
        loops: stateToSave.loops || {},
        parallels: stateToSave.parallels || {},
        edges: (stateToSave.edges || []).map((edge: any) => {
          const { sourceHandle, targetHandle, ...rest } = edge || {}
          const sanitized: any = { ...rest }
          if (typeof sourceHandle === 'string' && sourceHandle.length > 0) {
            sanitized.sourceHandle = sourceHandle
          }
          if (typeof targetHandle === 'string' && targetHandle.length > 0) {
            sanitized.targetHandle = targetHandle
          }
          return sanitized
        }),
      }

      const saveResponse = await fetch(`/api/workflows/${workflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanedWorkflowState),
      })

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json()
        throw new Error(
          errorData.error || `HTTP ${saveResponse.status}: ${saveResponse.statusText}`
        )
      }

      logger.info('Auto layout successfully persisted to database', { workflowId })
      return { success: true }
    } catch (saveError) {
      logger.error('Failed to save auto layout to database, reverting store changes:', {
        workflowId,
        error: saveError,
      })

      // Revert the store changes since database save failed
      useWorkflowStore.setState({
        ...workflowStore.getWorkflowState(),
        blocks: blocks,
        lastSaved: workflowStore.lastSaved,
      })

      return {
        success: false,
        error: `Failed to save positions to database: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown store update error'
    logger.error('Failed to update store with auto layout:', { workflowId, error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
