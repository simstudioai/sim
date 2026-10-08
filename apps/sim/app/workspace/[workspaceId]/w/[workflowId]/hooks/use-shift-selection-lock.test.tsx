/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useShiftSelectionLock } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-shift-selection-lock'

function renderShiftSelectionLock() {
  let api: ReturnType<typeof useShiftSelectionLock> | null = null
  const host = document.createElement('div')
  const root: Root = createRoot(host)

  function Probe() {
    api = useShiftSelectionLock({ isHandMode: false })
    return null
  }

  act(() => root.render(<Probe />))
  if (!api) throw new Error('hook did not render')

  return { api, unmount: () => act(() => root.unmount()) }
}

describe('useShiftSelectionLock', () => {
  it('does not swallow Shift clicks on selectable elements inside the pane', () => {
    const { api, unmount } = renderShiftSelectionLock()
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    const edge = document.createElement('path')
    edge.classList.add('react-flow__edge-interaction')
    pane.appendChild(edge)
    const preventDefault = vi.fn()

    api.handleCanvasMouseDown({
      shiftKey: true,
      target: edge,
      preventDefault,
    } as unknown as React.MouseEvent)

    expect(preventDefault).not.toHaveBeenCalled()
    unmount()
  })

  it('still prevents native selection when Shift-drag starts on the pane background', () => {
    const { api, unmount } = renderShiftSelectionLock()
    const pane = document.createElement('div')
    pane.className = 'react-flow__pane'
    const preventDefault = vi.fn()

    api.handleCanvasMouseDown({
      shiftKey: true,
      target: pane,
      preventDefault,
    } as unknown as React.MouseEvent)

    expect(preventDefault).toHaveBeenCalledOnce()
    unmount()
  })
})
