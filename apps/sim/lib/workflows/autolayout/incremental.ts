import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { AdjustmentOptions, Edge } from './types'
import { boxesOverlap, createBoundingBox, getBlockMetrics, shouldSkipAutoLayout } from './utils'

const logger = createLogger('AutoLayout:Incremental')

const DEFAULT_SHIFT_SPACING = 550

export function adjustForNewBlock(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  newBlockId: string,
  options: AdjustmentOptions = {}
): void {
  const newBlock = blocks[newBlockId]
  if (!newBlock) {
    logger.warn('New block not found in blocks', { newBlockId })
    return
  }

  if (shouldSkipAutoLayout(newBlock)) {
    logger.debug('Skipping incremental layout for block excluded from auto layout', {
      newBlockId,
      type: newBlock.type,
    })
    return
  }

  const shiftSpacing = options.horizontalSpacing ?? DEFAULT_SHIFT_SPACING

  const incomingEdges = edges.filter((e) => e.target === newBlockId)
  const outgoingEdges = edges.filter((e) => e.source === newBlockId)

  if (incomingEdges.length === 0 && outgoingEdges.length === 0) {
    logger.debug('New block has no connections, no adjustment needed', { newBlockId })
    return
  }

  const sourceBlocks = incomingEdges
    .map((e) => blocks[e.source])
    .filter((b) => b !== undefined && b.id !== newBlockId)

  if (sourceBlocks.length > 0) {
    const avgSourceX = sourceBlocks.reduce((sum, b) => sum + b.position.x, 0) / sourceBlocks.length
    const avgSourceY = sourceBlocks.reduce((sum, b) => sum + b.position.y, 0) / sourceBlocks.length
    const maxSourceX = Math.max(...sourceBlocks.map((b) => b.position.x))

    newBlock.position = {
      x: maxSourceX + shiftSpacing,
      y: avgSourceY,
    }

    logger.debug('Positioned new block based on source blocks', {
      newBlockId,
      position: newBlock.position,
      sourceCount: sourceBlocks.length,
    })
  }

  const targetBlocks = outgoingEdges
    .map((e) => blocks[e.target])
    .filter((b) => b !== undefined && b.id !== newBlockId)

  if (targetBlocks.length > 0 && sourceBlocks.length === 0) {
    const minTargetX = Math.min(...targetBlocks.map((b) => b.position.x))
    const avgTargetY = targetBlocks.reduce((sum, b) => sum + b.position.y, 0) / targetBlocks.length

    newBlock.position = {
      x: Math.max(150, minTargetX - shiftSpacing),
      y: avgTargetY,
    }

    logger.debug('Positioned new block based on target blocks', {
      newBlockId,
      position: newBlock.position,
      targetCount: targetBlocks.length,
    })
  }

  const newBlockMetrics = getBlockMetrics(newBlock)
  const newBlockBox = createBoundingBox(newBlock.position, newBlockMetrics)

  const blocksToShift: Array<{ block: BlockState; shiftAmount: number }> = []

  for (const [id, block] of Object.entries(blocks)) {
    if (id === newBlockId) continue
    if (block.data?.parentId) continue
    if (shouldSkipAutoLayout(block)) continue

    if (block.position.x >= newBlock.position.x) {
      const blockMetrics = getBlockMetrics(block)
      const blockBox = createBoundingBox(block.position, blockMetrics)

      if (boxesOverlap(newBlockBox, blockBox, 50)) {
        const requiredShift = newBlock.position.x + newBlockMetrics.width + 50 - block.position.x
        if (requiredShift > 0) {
          blocksToShift.push({ block, shiftAmount: requiredShift })
        }
      }
    }
  }

  if (blocksToShift.length > 0) {
    logger.debug('Shifting blocks to accommodate new block', {
      newBlockId,
      shiftCount: blocksToShift.length,
    })

    for (const { block, shiftAmount } of blocksToShift) {
      block.position.x += shiftAmount
    }
  }
}

export function compactHorizontally(blocks: Record<string, BlockState>, edges: Edge[]): void {
  const blockArray = Object.values(blocks).filter(
    (b) => !b.data?.parentId && !shouldSkipAutoLayout(b)
  )

  blockArray.sort((a, b) => a.position.x - b.position.x)

  const MIN_SPACING = 500

  for (let i = 1; i < blockArray.length; i++) {
    const prevBlock = blockArray[i - 1]
    const currentBlock = blockArray[i]

    const prevMetrics = getBlockMetrics(prevBlock)
    const expectedX = prevBlock.position.x + prevMetrics.width + MIN_SPACING

    if (currentBlock.position.x > expectedX + 150) {
      const shift = currentBlock.position.x - expectedX
      currentBlock.position.x = expectedX

      logger.debug('Compacted block horizontally', {
        blockId: currentBlock.id,
        shift,
      })
    }
  }
}
