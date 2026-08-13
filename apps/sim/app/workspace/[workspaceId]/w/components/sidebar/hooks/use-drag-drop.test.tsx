/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
}))

/** Kept out of the module graph so this suite does not pull emcn's CSS modules through postcss. */
vi.mock('@sim/emcn', () => ({ toast: { error: vi.fn() } }))

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

const { mockUseFolderStore, mockSetExpanded, expandedFolders } = vi.hoisted(() => {
  const expanded = new Set<string>()
  const setExpanded = vi.fn((folderId: string, isExpanded: boolean) => {
    if (isExpanded) expanded.add(folderId)
    else expanded.delete(folderId)
  })
  const folderState = {
    setExpanded,
    expandedFolders: expanded,
    clearSelection: () => {},
    clearFolderSelection: () => {},
  }
  const store = Object.assign(
    (selector: (state: typeof folderState) => unknown) => selector(folderState),
    { getState: () => folderState }
  )
  return { mockUseFolderStore: store, mockSetExpanded: setExpanded, expandedFolders: expanded }
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

/**
 * A `dragover` on a folder row. `clientY` sits in the middle band of the 100px rect, which is what
 * `calculateFolderDropPosition` reads as "inside" — the position that arms the spring-open timer.
 */
function fakeFolderDragOverEvent(): unknown {
  const currentTarget = {
    getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }),
  }
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    clientY: 50,
    target: {},
    currentTarget,
  }
}

/** A `drop` carrying no selection payload: enough to record the destination, then bail. */
function fakeDropEvent(): unknown {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    dataTransfer: { getData: () => '' },
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
    expandedFolders.clear()
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

/**
 * Hovering a collapsed folder mid-drag spring-opens it so you can drop inside. Every folder opened
 * that way that the drop did NOT land in has to close again, or dragging past a folder silently
 * leaves it open and the sidebar grows rows the user never asked to see.
 */
describe('useDragDrop spring-open revert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
    expandedFolders.clear()
  })

  /** Drives a drag that lingers over `folder-1` long enough to spring it open. */
  function dragOverFolderUntilExpanded() {
    act(() => {
      latest.handleDragStart(null)
    })
    act(() => {
      latest
        .createFolderDragHandlers('folder-1', null)
        .onDragOver(fakeFolderDragOverEvent() as never)
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
  }

  it('closes a folder it spring-opened when the drag ends without dropping into it', () => {
    dragOverFolderUntilExpanded()
    expect(mockSetExpanded).toHaveBeenCalledWith('folder-1', true)

    // Esc-cancel / release outside: `dragend` fires with no drop recorded.
    act(() => {
      latest.handleDragEnd()
    })

    expect(mockSetExpanded).toHaveBeenCalledWith('folder-1', false)
    expect(expandedFolders.has('folder-1')).toBe(false)
  })

  it('leaves a folder open when the drop landed inside it', () => {
    dragOverFolderUntilExpanded()
    mockSetExpanded.mockClear()

    // Drop inside folder-1, then the drag ends as it always does.
    act(() => {
      void latest.createFolderDragHandlers('folder-1', null).onDrop(fakeDropEvent() as never)
    })
    act(() => {
      latest.handleDragEnd()
    })

    expect(mockSetExpanded).not.toHaveBeenCalledWith('folder-1', false)
    expect(expandedFolders.has('folder-1')).toBe(true)
  })

  it('never closes a folder the user had already opened themselves', () => {
    expandedFolders.add('folder-1')

    dragOverFolderUntilExpanded()
    act(() => {
      latest.handleDragEnd()
    })

    // Already-expanded folders are skipped by the spring-open effect, so nothing to revert.
    expect(mockSetExpanded).not.toHaveBeenCalledWith('folder-1', false)
    expect(expandedFolders.has('folder-1')).toBe(true)
  })
})
