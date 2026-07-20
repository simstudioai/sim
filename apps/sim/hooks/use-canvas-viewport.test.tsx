/**
 * @vitest-environment jsdom
 */
import { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Node, ReactFlowInstance } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'

interface ProbeProps {
  instance: ReactFlowInstance
  embedded: boolean
}

function Probe({ instance, embedded }: ProbeProps) {
  const { fitViewToBounds } = useCanvasViewport(instance, { embedded })

  useLayoutEffect(() => {
    fitViewToBounds({ padding: 0, minZoom: 1, maxZoom: 1, duration: 0 })
  }, [fitViewToBounds])

  return null
}

describe('useCanvasViewport', () => {
  let container: HTMLDivElement
  let flowContainer: HTMLDivElement
  let root: Root
  let originalInnerWidth: number
  let originalInnerHeight: number

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    document.documentElement.style.setProperty('--sidebar-width', '300px')
    document.documentElement.style.setProperty('--panel-width', '400px')
    document.documentElement.style.setProperty('--terminal-height', '0px')

    flowContainer = document.createElement('div')
    flowContainer.className = 'react-flow'
    flowContainer.getBoundingClientRect = () => new DOMRect(600, 100, 500, 700)
    document.body.appendChild(flowContainer)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    flowContainer.remove()
    document.documentElement.style.removeProperty('--sidebar-width')
    document.documentElement.style.removeProperty('--panel-width')
    document.documentElement.style.removeProperty('--terminal-height')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
    vi.clearAllMocks()
  })

  it('centers embedded workflow nodes within the resource pane instead of global chrome', () => {
    const nodes: Node[] = [
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        data: {},
      },
    ]
    const setViewport = vi.fn()
    const instance = {
      getNodes: () => nodes,
      setViewport,
    } as unknown as ReactFlowInstance

    act(() => root.render(<Probe instance={instance} embedded />))

    expect(setViewport).toHaveBeenCalledWith({ x: 200, y: 300, zoom: 1 }, { duration: 0 })
  })
})
