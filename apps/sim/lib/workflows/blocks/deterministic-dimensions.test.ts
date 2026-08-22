/**
 * @vitest-environment node
 */
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
  it('floors a header-only card at the shortest paintable silhouette', () => {
    const { height, width } = calculateWorkflowBlockDimensions({
      blockType: 'starter',
      visibleSubBlockCount: 0,
    })

    expect(height).toBe(BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT)
    expect(width).toBe(BLOCK_DIMENSIONS.FIXED_WIDTH)
  })

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

  it('lets a summary replace both the chips row and every field row', () => {
    const { height } = calculateWorkflowBlockDimensions({
      blockType: 'table',
      visibleSubBlockCount: 4,
      chipCount: 2,
      sentenceLineCount: 2,
    })

    expect(height).toBe(
      HEADER_HEIGHT + WORKFLOW_CONTENT_PADDING + 2 * BLOCK_DIMENSIONS.WORKFLOW_SENTENCE_LINE_HEIGHT
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

  it('ignores chips and summaries on branch blocks, which render neither', () => {
    const plain = calculateWorkflowBlockDimensions({
      blockType: 'condition',
      visibleSubBlockCount: 0,
      conditionRowCount: 2,
    })
    const decorated = calculateWorkflowBlockDimensions({
      blockType: 'condition',
      visibleSubBlockCount: 0,
      conditionRowCount: 2,
      chipCount: 2,
      sentenceLineCount: 3,
    })

    expect(decorated.height).toBe(plain.height)
  })
})
