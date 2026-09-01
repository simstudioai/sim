/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetNodes } = vi.hoisted(() => ({ mockGetNodes: vi.fn() }))

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ getNodes: mockGetNodes }),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  Handle: () => null,
}))

import { useNodeUtilities } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-utilities'

/** Renders the hook and hands back what it returned, without a test library. */
function renderNodeUtilities(blockMap: Parameters<typeof useNodeUtilities>[0]) {
  let api: ReturnType<typeof useNodeUtilities> | null = null
  function Probe() {
    api = useNodeUtilities(blockMap)
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    createRoot(host).render(<Probe />)
  })
  if (!api) throw new Error('hook did not render')
  return api
}

/**
 * A container at (1000, 500) holding one child placed at the top-left of its
 * body — exactly where `clampPositionToContainer` floors a child.
 */
const CONTAINER_POSITION = { x: 1000, y: 500 }
const CHILD_POSITION = {
  x: CONTAINER_DIMENSIONS.LEFT_PADDING,
  y: CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING,
}

const blocks: Parameters<typeof useNodeUtilities>[0] = {
  loop: { id: 'loop', type: 'loop', position: CONTAINER_POSITION, data: {} },
  child: { id: 'child', type: 'gmail_v2', position: CHILD_POSITION, data: { parentId: 'loop' } },
  root: { id: 'root', type: 'gmail_v2', position: { x: 10, y: 20 }, data: {} },
}

const nodes = [
  { id: 'loop', position: CONTAINER_POSITION },
  { id: 'child', position: CHILD_POSITION, parentId: 'loop' },
  { id: 'root', position: { x: 10, y: 20 } },
]

describe('getNodeAbsolutePosition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodes.mockReturnValue(nodes)
  })

  it('places a child at its parent plus its own position, as React Flow does', () => {
    /* A child's position is already relative to the container's origin — the
       header and padding live in the position itself, put there by
       `clampPositionToContainer`. Adding them again reported a nested node 16px
       right and 66px below where it actually renders, which is why callers had
       to subtract the same constants back off. */
    const api = renderNodeUtilities(blocks)

    expect(api.getNodeAbsolutePosition('child')).toEqual({
      x: CONTAINER_POSITION.x + CHILD_POSITION.x,
      y: CONTAINER_POSITION.y + CHILD_POSITION.y,
    })
  })

  it('leaves a root-level node exactly where it is', () => {
    const api = renderNodeUtilities(blocks)

    expect(api.getNodeAbsolutePosition('root')).toEqual({ x: 10, y: 20 })
    expect(api.getNodeAbsolutePosition('loop')).toEqual(CONTAINER_POSITION)
  })

  it('round-trips: a child popped out of its container does not move', () => {
    /* Removing a parent stores the node's absolute position verbatim, so any
       drift here is a visible jump — the block used to drop 66px down and 16px
       right the moment it left the container. */
    const api = renderNodeUtilities(blocks)
    const absolute = api.getNodeAbsolutePosition('child')
    const container = api.getNodeAbsolutePosition('loop')

    expect({ x: absolute.x - container.x, y: absolute.y - container.y }).toEqual(CHILD_POSITION)
  })
})
