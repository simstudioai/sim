/**
 * @vitest-environment node
 */
import { CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { describe, expect, it } from 'vitest'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'

describe('calculateContainerDimensions', () => {
  it('covers the child it holds plus one trailing padding', () => {
    /* Child coordinates are relative to the container's own origin, so their
       far edge is already the distance to cover. */
    const child = { x: 273, y: 207.5, width: 250, height: 112 }

    expect(calculateContainerDimensions([child])).toEqual({
      width: child.x + child.width + CONTAINER_DIMENSIONS.RIGHT_PADDING,
      height: child.y + child.height + CONTAINER_DIMENSIONS.BOTTOM_PADDING,
    })
  })

  it('leaves the same gap under a child wherever the child sits', () => {
    const gapUnder = (y: number) =>
      calculateContainerDimensions([{ x: 600, y, width: 250, height: 112 }]).height - (y + 112)

    expect(gapUnder(400)).toBe(CONTAINER_DIMENSIONS.BOTTOM_PADDING)
    expect(gapUnder(700)).toBe(CONTAINER_DIMENSIONS.BOTTOM_PADDING)
  })

  it('holds a child pinned to the top-left clear of the chrome', () => {
    /* The floor `clampPositionToContainer` applies is what encodes the header
       and leading padding into the child's own coordinates — the sizing math
       reads them from there rather than adding them again. */
    const pinned = clampPositionToContainer(
      { x: -999, y: -999 },
      { width: 900, height: 900 },
      { width: 250, height: 112 }
    )

    expect(pinned).toEqual({
      x: CONTAINER_DIMENSIONS.LEFT_PADDING,
      y: CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING,
    })
  })

  it('falls back to the default box when it holds nothing', () => {
    expect(calculateContainerDimensions([])).toEqual({
      width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    })
  })

  it('never sizes below the default box', () => {
    expect(calculateContainerDimensions([{ x: 16, y: 66, width: 40, height: 20 }])).toEqual({
      width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    })
  })
})
