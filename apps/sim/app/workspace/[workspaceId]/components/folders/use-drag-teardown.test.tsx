/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDragTeardown } from '@/app/workspace/[workspaceId]/components/folders/use-drag-teardown'

const mountedRoots: Root[] = []

function renderDragTeardown(teardown: () => void) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)

  function Probe() {
    useDragTeardown(teardown)
    return null
  }

  act(() => {
    root.render(<Probe />)
  })
}

function fire(type: string) {
  act(() => {
    window.dispatchEvent(new Event(type, { bubbles: true }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  vi.useRealTimers()
})

describe('useDragTeardown', () => {
  it('tears down on dragend', () => {
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('dragover')
    fire('dragend')

    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('tears down on drop', () => {
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('dragover')
    fire('drop')

    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('tears down on the first pointermove after a drag, which dragend can miss', () => {
    // Spring-loading unmounts the source row, so `dragend` — dispatched at that node — never
    // reaches window. Browsers suppress pointer events during a drag, so the first one after
    // is an exact signal that the drag ended.
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('dragover')
    fire('pointermove')

    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('never tears down from the passage of time alone', () => {
    // Regression: an idle-timeout version of this tore the drag down whenever the user rested
    // on a folder waiting for it to spring open — the drag model reports only about every
    // 350ms while the pointer is still, so any timeout in that range trips on a held drag.
    // Nothing here may depend on a timer, so advancing the clock must change nothing.
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('dragover')
    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(teardown).not.toHaveBeenCalled()

    // And the drag is still live, so a real end signal still lands.
    fire('dragend')
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('ignores pointer movement when no drag is in flight', () => {
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('pointermove')
    fire('pointermove')

    expect(teardown).not.toHaveBeenCalled()
  })

  it('tears down once per drag, not on every event after it ends', () => {
    const teardown = vi.fn()
    renderDragTeardown(teardown)

    fire('dragover')
    fire('dragend')
    fire('pointermove')
    fire('pointermove')

    expect(teardown).toHaveBeenCalledTimes(1)
  })
})
