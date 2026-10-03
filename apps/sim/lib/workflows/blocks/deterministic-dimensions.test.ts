import { BLOCK_DIMENSIONS } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'

/**
 * The canvas card and auto-layout both size blocks through this function, so a
 * section the caller forgets to declare is a block laid out against a card it
 * does not paint. These pin the section arithmetic itself; the callers are
 * responsible for describing the same card to it.
 */

const { HEADER_HEIGHT, WORKFLOW_CONTENT_PADDING, WORKFLOW_CONTENT_GAP, WORKFLOW_ROW_HEIGHT } =
  BLOCK_DIMENSIONS

describe('calculateWorkflowBlockDimensions', () => {
  it('sums rows with one gap between each adjacent pair, not a per-row pitch', () => {
    const { height } = calculateWorkflowBlockDimensions({
      blockType: 'agent',
      visibleSubBlockCount: 3,
    })

    expect(height).toBe(
      HEADER_HEIGHT + WORKFLOW_CONTENT_PADDING + 3 * WORKFLOW_ROW_HEIGHT + 2 * WORKFLOW_CONTENT_GAP
    )
  })

  it('counts the error row as its own section', () => {
    const withoutError = calculateWorkflowBlockDimensions({
      blockType: 'agent',
      visibleSubBlockCount: 2,
    })
    const withError = calculateWorkflowBlockDimensions({
      blockType: 'agent',
      visibleSubBlockCount: 2,
      hasErrorRow: true,
    })

    expect(withError.height - withoutError.height).toBe(
      BLOCK_DIMENSIONS.WORKFLOW_ERROR_ROW_HEIGHT + WORKFLOW_CONTENT_GAP
    )
  })

  it('collapses any number of chips into a single fixed-height row', () => {
    const oneChip = calculateWorkflowBlockDimensions({
      blockType: 'gmail',
      visibleSubBlockCount: 1,
      chipCount: 1,
    })
    const twoChips = calculateWorkflowBlockDimensions({
      blockType: 'gmail',
      visibleSubBlockCount: 1,
      chipCount: 2,
    })

    expect(oneChip.height).toBe(twoChips.height)
    expect(oneChip.height).toBe(
      HEADER_HEIGHT +
        WORKFLOW_CONTENT_PADDING +
        BLOCK_DIMENSIONS.WORKFLOW_CHIPS_ROW_HEIGHT +
        WORKFLOW_ROW_HEIGHT +
        WORKFLOW_CONTENT_GAP
    )
  })

  it('sizes a router by its context row plus one row per route', () => {
    const { height } = calculateWorkflowBlockDimensions({
      blockType: 'router_v2',
      visibleSubBlockCount: 0,
      routerRowCount: 2,
    })

    expect(height).toBe(
      HEADER_HEIGHT + WORKFLOW_CONTENT_PADDING + 3 * WORKFLOW_ROW_HEIGHT + 2 * WORKFLOW_CONTENT_GAP
    )
  })
})
