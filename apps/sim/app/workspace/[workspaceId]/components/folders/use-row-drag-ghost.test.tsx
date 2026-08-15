/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type RowDragGhost,
  useRowDragGhost,
} from '@/app/workspace/[workspaceId]/components/folders/use-row-drag-ghost'

const mountedRoots: Root[] = []

function renderGhost() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)
  let result: RowDragGhost | undefined

  function Probe() {
    result = useRowDragGhost()
    return null
  }

  const render = () => {
    act(() => {
      root.render(<Probe />)
    })
  }
  render()

  return {
    get: () => {
      if (!result) throw new Error('Hook result is not ready')
      return result
    },
    rerender: render,
  }
}

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
})

describe('useRowDragGhost', () => {
  it('keeps a stable handle identity across renders', () => {
    // Consumers list this handle in the deps of the `endDrag` callback that `useDragTeardown`
    // binds and the drag config memo depends on. A fresh object per render makes `endDrag`
    // unstable and rebuilds the whole drag config every render.
    const ghost = renderGhost()

    const before = ghost.get()
    ghost.rerender()
    ghost.rerender()

    expect(ghost.get()).toBe(before)
  })

  it('removes the ghost node on unmount', () => {
    const ghost = renderGhost()
    const dataTransfer = { setDragImage: () => {} } as unknown as DataTransfer

    act(() => {
      ghost.get().attach({ dataTransfer } as never, 'Report.md', 1)
    })
    expect(document.body.children.length).toBe(1)

    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount()
    })
    expect(document.body.children.length).toBe(0)
  })
})
