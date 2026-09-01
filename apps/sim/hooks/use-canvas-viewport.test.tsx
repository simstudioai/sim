/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'

const mountedRoots: Root[] = []

function renderCanvasViewport() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)

  const setViewport = vi.fn()
  const reactFlowInstance = {
    getNodes: () => [],
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    setViewport,
  } as unknown as ReactFlowInstance
  let fitViewToBounds: ReturnType<typeof useCanvasViewport>['fitViewToBounds'] | undefined

  function Probe() {
    fitViewToBounds = useCanvasViewport(reactFlowInstance).fitViewToBounds
    return null
  }

  act(() => root.render(<Probe />))

  return {
    applyFit(nodes: Node[]) {
      fitViewToBounds?.({ nodes, padding: 0, minZoom: 0.01, maxZoom: 10, duration: 0 })
    },
    get viewport(): Viewport | undefined {
      return setViewport.mock.calls.at(-1)?.[0]
    },
  }
}

describe('useCanvasViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount()
    })
  })

  it('falls back from nonpositive measured dimensions to configured dimensions', () => {
    const probe = renderCanvasViewport()

    probe.applyFit([
      {
        id: 'node-1',
        position: { x: 100, y: 200 },
        data: {},
        measured: { width: 0, height: -1 },
        width: 250,
        height: 100,
      },
    ])

    expect(probe.viewport).toEqual({ x: -400, y: -600, zoom: 4 })
  })

  it('uses block defaults when measured and configured dimensions are not usable', () => {
    const probe = renderCanvasViewport()

    probe.applyFit([
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        data: {},
        measured: { width: 0, height: 0 },
        width: -1,
        height: -1,
      },
    ])

    expect(probe.viewport).toEqual({ x: 0, y: 200, zoom: 4 })
  })
})
