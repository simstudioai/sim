/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { canvas, nodesReady } = vi.hoisted(() => ({
  canvas: {
    width: 800,
    height: 400,
    viewportInitialized: false,
    getNodes: vi.fn(() => [{ id: 'start' }, { id: 'finish' }]),
    getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 300 })),
    fitBounds: vi.fn(),
  },
  nodesReady: { value: false },
}))

vi.mock('@xyflow/react', () => ({
  useNodesInitialized: () => nodesReady.value,
  useReactFlow: () => canvas,
  useStore: (selector: (state: typeof canvas) => unknown) => selector(canvas),
}))

import { FitViewAfterInit } from '@/components/workflow-preview/fit-view-after-init'

let host: HTMLDivElement
let root: Root
const OPTIONS = { padding: 0.3 }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  canvas.viewportInitialized = false
  canvas.width = 800
  canvas.height = 400
  nodesReady.value = false
  host = document.createElement('div')
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

function render() {
  act(() => root.render(<FitViewAfterInit options={OPTIONS} />))
}

describe('preview viewport initialization', () => {
  it('waits for a closed dialog to have visible dimensions before fitting', () => {
    nodesReady.value = true
    canvas.viewportInitialized = true
    canvas.width = 0
    canvas.height = 0
    render()
    expect(canvas.fitBounds).not.toHaveBeenCalled()
    canvas.width = 800
    canvas.height = 400
    render()
    expect(canvas.fitBounds).toHaveBeenCalledTimes(1)
  })
  it('waits for both measured nodes and a mounted viewport before fitting every node', () => {
    render()
    nodesReady.value = true
    render()
    expect(canvas.fitBounds).not.toHaveBeenCalled()
    canvas.viewportInitialized = true
    render()
    expect(canvas.getNodesBounds).toHaveBeenCalledWith([{ id: 'start' }, { id: 'finish' }])
    expect(canvas.fitBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1000, height: 300 }, OPTIONS)
  })

  it('preserves reader pan and zoom when selecting a block causes nodes to remeasure', () => {
    canvas.viewportInitialized = true
    nodesReady.value = true
    render()
    nodesReady.value = false
    render()
    nodesReady.value = true
    render()
    expect(canvas.fitBounds).toHaveBeenCalledTimes(1)
  })
})
