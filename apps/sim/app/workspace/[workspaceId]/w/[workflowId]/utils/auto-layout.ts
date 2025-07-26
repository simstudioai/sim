import { createLogger } from '@/lib/logs/console-logger'

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

    // Import auto layout service
    const { autoLayoutWorkflow } = await import('@/lib/autolayout/service')

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

    // Apply auto layout
    const layoutedBlocks = await autoLayoutWorkflow(blocks, edges, layoutOptions)

    logger.info('Successfully applied auto layout', {
      workflowId,
      originalBlockCount: Object.keys(blocks).length,
      layoutedBlockCount: Object.keys(layoutedBlocks).length,
    })

    return {
      success: true,
      layoutedBlocks,
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
    const { blocks, edges } = workflowStore

    if (Object.keys(blocks).length === 0) {
      logger.warn('No blocks to layout', { workflowId })
      return { success: false, error: 'No blocks to layout' }
    }

    // Apply auto layout
    const result = await applyAutoLayoutToWorkflow(workflowId, blocks, edges, options)

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

    // Save to database in background (don't await to keep UI responsive)
    saveAutoLayoutToDatabase(workflowId, options)

    return { success: true }
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
 * Save auto layout changes to database in background
 */
async function saveAutoLayoutToDatabase(
  workflowId: string,
  options: AutoLayoutOptions = {}
): Promise<void> {
  try {
    logger.info('Saving auto layout to database', { workflowId })

    const response = await fetch(`/api/workflows/${workflowId}/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategy: options.strategy || DEFAULT_AUTO_LAYOUT_OPTIONS.strategy,
        direction: options.direction || DEFAULT_AUTO_LAYOUT_OPTIONS.direction,
        spacing: {
          ...DEFAULT_AUTO_LAYOUT_OPTIONS.spacing,
          ...options.spacing,
        },
        alignment: options.alignment || DEFAULT_AUTO_LAYOUT_OPTIONS.alignment,
        padding: {
          ...DEFAULT_AUTO_LAYOUT_OPTIONS.padding,
          ...options.padding,
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()
    logger.info('Successfully saved auto layout to database', { workflowId, result })
  } catch (error) {
    logger.error('Failed to save auto layout to database (store already updated):', {
      workflowId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    // Don't throw - the store is already updated, so the UI is correct
    // The socket will eventually sync when the database is available
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
  return applyAutoLayoutToWorkflow('preview', blocks, edges, options)
}
