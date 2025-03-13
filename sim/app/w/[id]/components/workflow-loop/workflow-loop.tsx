import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { Loop } from '@/stores/workflows/workflow/types'

interface WorkflowLoopProps {
  loopId: string
  loop: Loop
  blocks: Record<string, any>
}

// Helper function to create loop label node
function createLoopLabelNode(loopId: string, bounds: { x: number; y: number }) {
  return {
    id: `loop-label-${loopId}`,
    type: 'loopLabel',
    position: { x: 0, y: -32 },
    parentNode: `loop-${loopId}`,
    draggable: false,
    data: {
      label: 'Loop',
    },
  }
}

// Helper function to create loop input node
function createLoopInputNode(loopId: string, bounds: { x: number; width: number }) {
  const loop = useWorkflowStore.getState().loops[loopId]
  const BADGE_WIDTH = loop?.maxIterations > 9 ? 153 : 144

  return {
    id: `loop-input-${loopId}`,
    type: 'loopInput',
    position: { x: bounds.width - BADGE_WIDTH, y: -32 }, // Position from right edge
    parentNode: `loop-${loopId}`,
    draggable: false,
    data: {
      loopId,
    },
  }
}

function calculateLoopBounds(loop: Loop, blocks: Record<string, any>) {
  // Get all blocks in this loop and filter out any undefined blocks
  const loopBlocks = loop.nodes
    .map((id) => blocks[id])
    .filter(
      (block): block is NonNullable<typeof block> =>
        block !== undefined && block.position !== undefined
    )

  if (!loopBlocks.length) return null

  // Calculate bounds of all blocks in loop
  const bound = loopBlocks.reduce(
    (acc, block) => {
      // Calculate block dimensions
      const blockWidth = block.isWide ? 480 : 320
      const blockHeight = block.height || 200 // Fallback height if not set

      // Update bounds
      acc.minX = Math.min(acc.minX, block.position.x)
      acc.minY = Math.min(acc.minY, block.position.y)
      acc.maxX = Math.max(acc.maxX, block.position.x + blockWidth)
      acc.maxY = Math.max(acc.maxY, block.position.y + blockHeight)
      return acc
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )

  // Add padding around the group with extra bottom padding
  const PADDING = {
    TOP: 50,
    RIGHT: 50,
    BOTTOM: 110,
    LEFT: 50,
  }

  return {
    x: bound.minX - PADDING.LEFT,
    y: bound.minY - PADDING.TOP,
    width: bound.maxX - bound.minX + PADDING.LEFT + PADDING.RIGHT,
    height: bound.maxY - bound.minY + PADDING.TOP + PADDING.BOTTOM,
  }
}

// Update the createLoopNode function
export function createLoopNode({ loopId, loop, blocks }: WorkflowLoopProps) {
  const loopBounds = calculateLoopBounds(loop, blocks)
  if (!loopBounds) return null

  const loopNode = {
    id: `loop-${loopId}`,
    type: 'group',
    position: { x: loopBounds.x, y: loopBounds.y },
    className: 'bg-[rgb(247,247,248)] dark:bg-[rgb(36,37,45)]',
    style: {
      border: '1px solid rgb(203, 213, 225)',
      borderRadius: '12px',
      width: loopBounds.width,
      height: loopBounds.height,
      pointerEvents: 'none',
      zIndex: -1,
      isolation: 'isolate',
    },
    darkModeStyle: {
      borderColor: 'rgb(63, 63, 70)',
    },
    data: {
      label: 'Loop',
    },
  }

  // Create both label and input nodes
  const labelNode = createLoopLabelNode(loopId, loopBounds)
  const inputNode = createLoopInputNode(loopId, loopBounds)

  // Return all three nodes
  return [loopNode, labelNode, inputNode]
}

// Helper function to calculate relative position for child blocks
export function getRelativeLoopPosition(
  blockPosition: { x: number; y: number },
  loopBounds: { x: number; y: number }
) {
  return {
    x: blockPosition.x - loopBounds.x,
    y: blockPosition.y - loopBounds.y,
  }
}
