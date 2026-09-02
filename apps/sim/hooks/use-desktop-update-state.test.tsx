/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  onState: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((state: DesktopUpdateState) => void) | null,
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopUpdates: () => ({
    getState: desktopMocks.getState,
    onState: desktopMocks.onState,
  }),
}))

import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'

let container: HTMLDivElement
let root: Root
let currentState: DesktopUpdateState

function Harness() {
  currentState = useDesktopUpdateState()
  return null
}

describe('useDesktopUpdateState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktopMocks.listener = null
    desktopMocks.onState.mockImplementation((listener) => {
      desktopMocks.listener = listener
      return desktopMocks.unsubscribe
    })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (container.isConnected) {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('does not let a stale snapshot replace a newer state event', async () => {
    let resolveSnapshot: (state: DesktopUpdateState) => void = () => {
      throw new Error('Update-state snapshot did not initialize')
    }
    desktopMocks.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    )
    await act(async () => root.render(<Harness />))

    act(() => desktopMocks.listener?.({ status: 'ready', version: '2.0.0' }))
    await act(async () => resolveSnapshot({ status: 'checking' }))

    expect(currentState).toEqual({ status: 'ready', version: '2.0.0' })
  })

  it('unsubscribes and ignores a snapshot after unmount', async () => {
    let resolveSnapshot: (state: DesktopUpdateState) => void = () => {
      throw new Error('Update-state snapshot did not initialize')
    }
    desktopMocks.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    )
    await act(async () => root.render(<Harness />))
    act(() => root.unmount())
    container.remove()

    await act(async () => resolveSnapshot({ status: 'ready', version: '2.0.0' }))

    expect(desktopMocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
