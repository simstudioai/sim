import type { SimDesktopApi } from '@sim/desktop-bridge'
import { describe, expect, it, vi } from 'vitest'

const { exposeInMainWorld, invoke } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}))

await import('@/preload/index')

describe('desktop preload bridge', () => {
  it('normalizes and forwards browser panel force-hide requests', async () => {
    const exposed = exposeInMainWorld.mock.calls.find(([name]) => name === 'simDesktop')?.[1] as
      | SimDesktopApi
      | undefined
    expect(exposed).toBeDefined()
    if (!exposed) throw new Error('Expected the desktop preload API to be exposed')
    expect(exposed.browserAgent.supportsAtomicPanelOcclusion).toBe(true)

    await exposed.browserAgent.setPanelOccluded(true, 'chat-default')
    await exposed.browserAgent.setPanelOccluded(false, 'chat-explicit-false', false)
    await exposed.browserAgent.setPanelOccluded(true, 'chat-force', true)

    expect(invoke.mock.calls).toEqual([
      ['browser-agent:set-panel-occluded', true, 'chat-default', false],
      ['browser-agent:set-panel-occluded', false, 'chat-explicit-false', false],
      ['browser-agent:set-panel-occluded', true, 'chat-force', true],
    ])
  })
})
