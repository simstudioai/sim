import { createLogger } from '@sim/logger'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_LAYOUT_PADDING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('AutoLayoutUtils')

/**
 * Auto layout options interface
 */
export interface AutoLayoutOptions {
  spacing?: {
    horizontal?: number
    vertical?: number
  }
  alignment?: 'start' | 'center' | 'end'
  padding?: {
    x?: number
    y?: number
  }
  gridSize?: number
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

    // Check for locked blocks - auto-layout is disabled when blocks are locked
    const hasLockedBlocks = Object.values(blocks).some((block) => block.locked)
    if (hasLockedBlocks) {
      logger.info('Auto layout skipped: workflow contains locked blocks', { workflowId })
      return {
        success: false,
        error: 'Auto-layout is disabled when blocks are locked. Unlock blocks to use auto-layout.',
      }
    }

    // Merge with default options
    const layoutOptions = {
      spacing: {
        horizontal: options.spacing?.horizontal ?? DEFAULT_HORIZONTAL_SPACING,
        vertical: options.spacing?.vertical ?? DEFAULT_VERTICAL_SPACING,
      },
      alignment: options.alignment ?? 'center',
      padding: {
        x: options.padding?.x ?? DEFAULT_LAYOUT_PADDING.x,
        y: options.padding?.y ?? DEFAULT_LAYOUT_PADDING.y,
      },
      gridSize: options.gridSize,
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
