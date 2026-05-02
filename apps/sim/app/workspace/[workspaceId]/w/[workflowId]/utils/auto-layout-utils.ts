import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  putWorkflowNormalizedStateContract,
  type WorkflowStateContractInput,
  workflowAutoLayoutContract,
} from '@/lib/api/contracts/workflows'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_LAYOUT_PADDING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

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

    let result: Awaited<ReturnType<typeof requestJson<typeof workflowAutoLayoutContract>>>
    try {
      result = await requestJson(workflowAutoLayoutContract, {
        params: { id: workflowId },
        body: {
          ...layoutOptions,
          blocks,
          edges,
          loops,
          parallels,
        },
      })
    } catch (error) {
      const errorMessage =
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Auto layout failed'
      logger.error('Auto layout API call failed:', { error: errorMessage })
      return { success: false, error: errorMessage }
    }

    // The contract's `workflowBlockStateSchema` and the store's `BlockState`
    // describe the same runtime shape but TS sees the contract's
    // `SubBlockState.value` as `unknown` (zod default) while the store
    // narrows it to the editor's per-input value union. The contract's
    // shape is structurally a supertype of the store's, so this is a
    // single safe widening cast (store -> wire) on the way back in.
    const layoutedBlocks: Record<string, BlockState> =
      (result.data.layoutedBlocks as Record<string, BlockState>) || blocks
    const mergedBlocks = mergeSubblockState(layoutedBlocks, workflowId)

    const newWorkflowState = {
      ...workflowStore.getWorkflowState(),
      blocks: mergedBlocks,
      lastSaved: Date.now(),
    }

    useWorkflowStore.getState().replaceWorkflowState(newWorkflowState)

    logger.info('Successfully updated workflow store with auto layout', { workflowId })

    // Persist the changes to the database optimistically
    try {
      useWorkflowStore.getState().updateLastSaved()

      const { dragStartPosition, ...stateToSave } = newWorkflowState

      type ContractEdgeInput = WorkflowStateContractInput['edges'][number]

      // Mirror the diff store's sanitization: schema rejects nullable
      // sourceHandle/targetHandle (input type is `string | undefined`),
      // but the store's reactflow `Edge` type carries `string | null |
      // undefined`. Drop nulls before sending so the contract input
      // parses cleanly.
      const sanitizedEdges: ContractEdgeInput[] = (stateToSave.edges || []).map((edge: Edge) => {
        const { sourceHandle, targetHandle, ...rest } = edge
        const sanitized: ContractEdgeInput = { ...rest } as ContractEdgeInput
        if (typeof sourceHandle === 'string' && sourceHandle.length > 0) {
          sanitized.sourceHandle = sourceHandle
        }
        if (typeof targetHandle === 'string' && targetHandle.length > 0) {
          sanitized.targetHandle = targetHandle
        }
        return sanitized
      })

      const cleanedWorkflowState: WorkflowStateContractInput = {
        ...stateToSave,
        loops: stateToSave.loops || {},
        parallels: stateToSave.parallels || {},
        edges: sanitizedEdges,
      }

      await requestJson(putWorkflowNormalizedStateContract, {
        params: { id: workflowId },
        body: cleanedWorkflowState,
      })

      logger.info('Auto layout successfully persisted to database', { workflowId })
      return { success: true }
    } catch (saveError) {
      logger.error('Failed to save auto layout to database, reverting store changes:', {
        workflowId,
        error: saveError,
      })

      // Revert the store changes since database save failed
      const revertBlocks = mergeSubblockState(blocks, workflowId)
      useWorkflowStore.getState().replaceWorkflowState({
        ...workflowStore.getWorkflowState(),
        blocks: revertBlocks,
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
