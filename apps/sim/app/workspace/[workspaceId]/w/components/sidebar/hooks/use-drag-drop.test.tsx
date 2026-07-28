/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
}))

vi.mock('@/hooks/queries/folders', () => ({
  useReorderFolders: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useReorderWorkflows: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/queries/utils/folder-cache', () => ({
  getFolderMap: () => ({}),
}))

vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  getWorkflows: () => [],
}))

vi.mock('@/lib/folders/tree', () => ({
  getFolderPath: () => [],
}))

const { mockUseFolderStore } = vi.hoisted(() => {
  const folderState = { setExpanded: () => {}, expandedFolders: new Set<string>() }
  const store = Object.assign(
    (selector: (state: typeof folderState) => unknown) => selector(folderState),
    { getState: () => folderState }
  )
  return { mockUseFolderStore: store }
})
vi.mock('@/stores/folders/store', () => ({ useFolderStore: mockUseFolderStore }))

import { useDragDrop } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-drag-drop'

type DragDropApi = ReturnType<typeof useDragDrop>

let latest: DragDropApi

function Harness() {
  latest = useDragDrop()
  return null
}

/** Minimal stand-in for the dragOver event `initDragOver` consumes. */
function fakeDragOverEvent(): unknown {
  const node = {}
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    clientY: 0,
    // target !== currentTarget so the root drop zone skips indicator math (getBoundingClientRect)
    target: node,
    currentTarget: {},
  }
}

let container: HTMLDivElement
let root: Root

describe('useDragDrop stranded-drag reset', () => {
  beforeEach(() => {
    // Prevent the auto-scroll rAF loop from spinning in jsdom.
    vi.stubGlobal(
      'requestAnimationFrame',
      () => 0 as unknown as ReturnType<typeof requestAnimationFrame>
    )
    vi.stubGlobal('cancelAnimationFrame', () => {})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<Harness />)
    })
    // The reset listeners only attach once a scroll container is registered.
    act(() => {
      latest.setScrollContainer(document.createElement('div'))
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('clears isDragging on a window dragend when no drop fired', () => {
    // A drag entering the list flips isDragging on via initDragOver.
    act(() => {
      latest.createRootDropZone().onDragOver(fakeDragOverEvent() as never)
    })
    expect(latest.isDragging).toBe(true)

    // The drag is cancelled/dropped outside the list: only `dragend` fires, no `drop`.
    act(() => {
      window.dispatchEvent(new Event('dragend'))
    })
    expect(latest.isDragging).toBe(false)
  })

  it('keeps isDragging active across dragOver updates until the drag ends', () => {
    act(() => {
      latest.createRootDropZone().onDragOver(fakeDragOverEvent() as never)
    })
    expect(latest.isDragging).toBe(true)

    // A subsequent dragOver must not tear down the active drag.
    act(() => {
      latest.createRootDropZone().onDragOver(fakeDragOverEvent() as never)
    })
    expect(latest.isDragging).toBe(true)
  })
})
