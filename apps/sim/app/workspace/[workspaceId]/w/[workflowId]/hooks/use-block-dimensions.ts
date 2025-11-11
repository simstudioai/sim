import { useEffect, useRef } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface BlockDimensions {
  width: number
  height: number
}

interface UseBlockDimensionsOptions {
  blockId: string
  calculateDimensions: () => BlockDimensions
  dependencies: React.DependencyList
}

/**
 * Shared block dimension constants
 */
export const BLOCK_DIMENSIONS = {
  FIXED_WIDTH: 250,
  HEADER_HEIGHT: 40,
  MIN_HEIGHT: 100,

  // Workflow blocks
  WORKFLOW_CONTENT_PADDING: 16,
  WORKFLOW_ROW_HEIGHT: 29,

  // Note blocks
  NOTE_CONTENT_PADDING: 14,
  NOTE_MIN_CONTENT_HEIGHT: 20,
  NOTE_BASE_CONTENT_HEIGHT: 60,
} as const

/**
 * Hook to manage deterministic block dimensions without ResizeObserver.
 * Calculates dimensions based on content structure and updates the store.
 *
 * @param options - Configuration for dimension calculation
 * @param options.blockId - The ID of the block
 * @param options.calculateDimensions - Function that returns current dimensions
 * @param options.dependencies - Dependencies that trigger recalculation
 */
export function useBlockDimensions({
  blockId,
  calculateDimensions,
  dependencies,
}: UseBlockDimensionsOptions) {
  const updateNodeInternals = useUpdateNodeInternals()
  const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)
  const previousDimensions = useRef<BlockDimensions | null>(null)

  useEffect(() => {
    const dimensions = calculateDimensions()
    const previous = previousDimensions.current

    if (!previous || previous.width !== dimensions.width || previous.height !== dimensions.height) {
      previousDimensions.current = dimensions
      updateBlockLayoutMetrics(blockId, dimensions)
      updateNodeInternals(blockId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, updateBlockLayoutMetrics, updateNodeInternals, ...dependencies])
}
