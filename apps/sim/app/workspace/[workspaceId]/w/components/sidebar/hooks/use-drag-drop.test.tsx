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

/**
 * Registers a scroll container spanning x 0-200, then arms a drop indicator on it. Registration has
 * to precede the first dragOver: the listener effect reads the container ref when `isDragging`
 * flips, and `setScrollContainer` is a plain ref setter that triggers no re-render of its own.
 */
function armDragOverScrollContainer(): HTMLDivElement {
  const scrollContainer = document.createElement('div')
  scrollContainer.getBoundingClientRect = () =>
    ({ left: 0, right: 200, top: 0, bottom: 400 }) as DOMRect
  document.body.appendChild(scrollContainer)
  act(() => {
    latest.setScrollContainer(scrollContainer)
  })
  act(() => {
    latest.createEdgeDropZone('workflow-1', 'before').onDragOver(fakeDragOverEvent() as never)
  })
  return scrollContainer
}

/** Chrome's `dragleave` shape: bubbles, and always reports a null `relatedTarget`. */
function dispatchBubbledDragLeave(element: HTMLElement, clientX: number) {
  act(() => {
    const leave = new Event('dragleave', { bubbles: true }) as DragEvent
    Object.defineProperties(leave, {
      relatedTarget: { value: null },
      clientX: { value: clientX },
      clientY: { value: 200 },
    })
    element.dispatchEvent(leave)
  })
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

  /**
   * `dragleave` bubbles and Chrome nulls its `relatedTarget`, so the container listener sees one
   * for every descendant boundary the pointer crosses. Treating those as "left the list" wiped the
   * drop indicator mid-drag, and `handleDrop` bails on a null indicator — so a release just after
   * crossing a boundary did nothing at all. Nested rows in an expanded folder cross the most
   * boundaries, which is why open folders looked like they broke dragging outright.
   */
  it('keeps the drop indicator when a bubbled dragleave has no relatedTarget but the pointer is still inside', () => {
    const scrollContainer = armDragOverScrollContainer()
    expect(latest.dropIndicator).toEqual({
      targetId: 'workflow-1',
      position: 'before',
      folderId: null,
    })

    // A child row handing off to its sibling: pointer still well inside the list's 0-200 x-range.
    dispatchBubbledDragLeave(scrollContainer, 100)

    expect(latest.dropIndicator).not.toBeNull()
    scrollContainer.remove()
  })

  /**
   * The root drop zone's own `onDragLeave` clears the indicator through `isLeavingElement`, which
   * made the same null-`relatedTarget` assumption. Fixing only the container listener would have
   * left this second path clearing the indicator on every internal crossing.
   */
  it('keeps the drop indicator when the root drop zone sees a relatedTarget-less dragleave inside itself', () => {
    const zone = document.createElement('div')
    zone.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 400 }) as DOMRect

    act(() => {
      latest.createEdgeDropZone('workflow-1', 'before').onDragOver(fakeDragOverEvent() as never)
    })
    expect(latest.dropIndicator).not.toBeNull()

    act(() => {
      latest.createRootDropZone().onDragLeave({
        relatedTarget: null,
        currentTarget: zone,
        clientX: 100,
        clientY: 200,
      } as never)
    })

    expect(latest.dropIndicator).not.toBeNull()
  })

  it('clears the drop indicator when the pointer genuinely leaves the list', () => {
    const scrollContainer = armDragOverScrollContainer()
    expect(latest.dropIndicator).not.toBeNull()

    dispatchBubbledDragLeave(scrollContainer, 900)

    expect(latest.dropIndicator).toBeNull()
    scrollContainer.remove()
  })

  it('keeps isDragging active across dragOver updates until the drag ends', () => {
    act(() => {
      latest.createRootDropZone().onDragOver(fakeDragOverEvent() as never)
    })
    expect(latest.isDragging).toBe(true)

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

    // `dragend` fires after every drop, so the revert path runs here too.
    act(() => {
      void latest.createFolderDragHandlers('folder-1', null).onDrop(fakeDropEvent() as never)
    })
    act(() => {
      latest.handleDragEnd()
    })

    expect(mockSetExpanded).not.toHaveBeenCalledWith('folder-1', false)
    expect(expandedFolders.has('folder-1')).toBe(true)
  })

  /**
   * The spring-open timer is armed for 400ms, so a drag ending just before it fires leaves it
   * pending. Relying on the effect cleanup to cancel it would let it land after the drag-end
   * collapse had already emptied the set — re-adding the folder for the *next* drag to close, by
   * which point the user had opened it themselves.
   */
  it('does not spring-open a folder when the drag ends before the timer fires', () => {
    act(() => {
      latest.handleDragStart(null)
    })
    act(() => {
      latest
        .createFolderDragHandlers('folder-1', null)
        .onDragOver(fakeFolderDragOverEvent() as never)
    })

    /**
     * Deliberately outside `act`: the race only exists while React has scheduled the drag-end state
     * changes but not yet committed them, so the effect cleanup has not run and the timer is still
     * armed. Wrapping this in `act` would flush the commit first and cancel the timer via the
     * cleanup, hiding the very gap under test.
     */
    latest.handleDragEnd()
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockSetExpanded).not.toHaveBeenCalledWith('folder-1', true)
    expect(expandedFolders.has('folder-1')).toBe(false)

    // Nothing was left behind for a later drag to collapse.
    act(() => {
      latest.handleDragEnd()
    })
    expect(mockSetExpanded).not.toHaveBeenCalledWith('folder-1', false)
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
