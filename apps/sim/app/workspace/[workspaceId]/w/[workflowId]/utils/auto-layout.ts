import { createLogger } from '@/lib/logs/console/logger'

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
const DEFAULT_AUTO_LAYOUT_OPTIONS: AutoLayoutOptions = {
  strategy: 'smart',
  direction: 'auto',
  spacing: {
    horizontal: 500,
    vertical: 400,
    layer: 700,
  },
  alignment: 'center',
  padding: {
    x: 250,
    y: 250,
  },
}

/**
 * Apply auto layout to workflow blocks and update the store
 */
export async function applyAutoLayoutToWorkflow(
  workflowId: string,
  blocks: Record<string, any>,
  edges: any[],
  loops: Record<string, any> = {},
  parallels: Record<string, any> = {},
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, any>
  error?: string
}> {
  try {
    logger.info('Applying auto layout to workflow', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    // Call the autolayout API route instead of sim-agent directly

    // Merge with default options and ensure all required properties are present
    const layoutOptions = {
      strategy: options.strategy || DEFAULT_AUTO_LAYOUT_OPTIONS.strategy!,
      direction: options.direction || DEFAULT_AUTO_LAYOUT_OPTIONS.direction!,
      spacing: {
        horizontal: options.spacing?.horizontal || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.horizontal!,
        vertical: options.spacing?.vertical || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.vertical!,
        layer: options.spacing?.layer || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.layer!,
      },
      alignment: options.alignment || DEFAULT_AUTO_LAYOUT_OPTIONS.alignment!,
      padding: {
        x: options.padding?.x || DEFAULT_AUTO_LAYOUT_OPTIONS.padding!.x!,
        y: options.padding?.y || DEFAULT_AUTO_LAYOUT_OPTIONS.padding!.y!,
      },
    }

    // Call the autolayout API route which has access to the server-side API key
    const response = await fetch(`/api/workflows/${workflowId}/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(layoutOptions),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const errorMessage = errorData?.error || `Auto layout failed: ${response.statusText}`
      logger.error('Auto layout API call failed:', {
        status: response.status,
        error: errorMessage,
      })
      return {
        success: false,
        error: errorMessage,
      }
    }

    const result = await response.json()

    if (!result.success) {
      const errorMessage = result.error || 'Auto layout failed'
      logger.error('Auto layout failed:', {
        error: errorMessage,
      })
      return {
        success: false,
        error: errorMessage,
      }
    }

    logger.info('Successfully applied auto layout', {
      workflowId,
      originalBlockCount: Object.keys(blocks).length,
      layoutedBlockCount: result.data?.layoutedBlocks
        ? Object.keys(result.data.layoutedBlocks).length
        : 0,
    })

    // Return the layouted blocks from the API response
    return {
      success: true,
      layoutedBlocks: result.data?.layoutedBlocks || blocks,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown auto layout error'
    logger.error('Auto layout failed:', { workflowId, error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Apply auto layout and update the workflow store immediately
 */
export async function applyAutoLayoutAndUpdateStore(
  workflowId: string,
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // Import workflow store
    const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')

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

    // Apply auto layout
    const result = await applyAutoLayoutToWorkflow(
      workflowId,
      blocks,
      edges,
      loops,
      parallels,
      options
    )

    if (!result.success || !result.layoutedBlocks) {
      return { success: false, error: result.error }
    }

    // Update workflow store immediately with new positions
    const newWorkflowState = {
      ...workflowStore.getWorkflowState(),
      blocks: result.layoutedBlocks,
      lastSaved: Date.now(),
    }

    useWorkflowStore.setState(newWorkflowState)

    logger.info('Successfully updated workflow store with auto layout', { workflowId })

    // Persist the changes to the database optimistically
    try {
      // Update the lastSaved timestamp in the store
      useWorkflowStore.getState().updateLastSaved()

      // Clean up the workflow state for API validation
      const cleanedWorkflowState = {
        ...newWorkflowState,
        // Convert null dates to undefined (since they're optional)
        deployedAt: newWorkflowState.deployedAt ? new Date(newWorkflowState.deployedAt) : undefined,
        // Ensure other optional fields are properly handled
        loops: newWorkflowState.loops || {},
        parallels: newWorkflowState.parallels || {},
        deploymentStatuses: newWorkflowState.deploymentStatuses || {},
      }

      // Save the updated workflow state to the database
      const response = await fetch(`/api/workflows/${workflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanedWorkflowState),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
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
        blocks: blocks, // Revert to original blocks
        lastSaved: workflowStore.lastSaved, // Revert lastSaved
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

/**
 * Apply auto layout to a specific set of blocks (used by copilot preview)
 */
export async function applyAutoLayoutToBlocks(
  blocks: Record<string, any>,
  edges: any[],
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, any>
  error?: string
}> {
  return applyAutoLayoutToWorkflow('preview', blocks, edges, {}, {}, options)
}
