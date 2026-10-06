/** @vitest-environment jsdom */
import { act } from 'react'
import type { ComputerUseActivity as Activity, ComputerUseStatus } from '@sim/desktop-bridge'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerUseActivity } from '@/components/computer-use/activity'

const native = vi.hoisted(() => ({
  getStatus: vi.fn<() => Promise<ComputerUseStatus>>(),
  cancel: vi.fn<() => Promise<void>>(),
  onActivity: vi.fn<(listener: (activity: Activity | null) => void) => () => void>(),
}))
vi.mock('@/lib/desktop', () => libDesktopMock)

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({ computerUse: native })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  native.cancel.mockResolvedValue(undefined)
  native.onActivity.mockReturnValue(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each(['pending', 'failed'] as const)(
  'keeps Stop usable while native permission status is %s',
  async (state) => {
    native.getStatus.mockImplementation(() =>
      state === 'failed' ? Promise.reject(new Error('unavailable')) : new Promise(() => {})
    )
    await act(async () => root.render(<ComputerUseActivity />))
    const listener = native.onActivity.mock.calls[0]?.[0]
    if (!listener) throw new Error('Activity listener not registered')
    await act(async () =>
      listener({
        toolCallId: 'action',
        scopeId: 'chat',
        appName: 'Synthetic app',
        action: 'click',
        startedAt: Date.now(),
      })
    )
    const stop = container.querySelector<HTMLButtonElement>('button')
    expect(stop?.textContent).toContain('Stop')
    await act(async () => stop?.click())
    expect(native.cancel).toHaveBeenCalledOnce()
    await act(async () => listener(null))
    expect(container.querySelector('button')).toBeNull()
  }
)
