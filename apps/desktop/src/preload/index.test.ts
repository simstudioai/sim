import type { SimDesktopApi } from '@sim/desktop-bridge'
import { describe, expect, it, vi } from 'vitest'

const { exposeInMainWorld, invoke, send } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(() => Promise.resolve(true)),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send,
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

    exposed.browserAgent.registerSitePermissionPromptSupport?.()
    await exposed.browserAgent.cancelTool?.('tool-1', 'chat-default')
    await exposed.browserAgent.cancelActiveTool?.('chat-reloaded')
    await exposed.browserAgent.setPanelOccluded(true, 'chat-default')
    await exposed.browserAgent.setPanelOccluded(false, 'chat-explicit-false', false)
    await exposed.browserAgent.setPanelOccluded(true, 'chat-force', true)
    await exposed.browserAgent.getSearchSuggestions?.('sim ai')
    await exposed.settings.setBrowserSearchSuggestionsEnabled?.(false)

    expect(invoke.mock.calls).toEqual([
      ['browser-agent:cancel-tool', 'tool-1', 'chat-default'],
      ['browser-agent:cancel-active-tool', 'chat-reloaded'],
      ['browser-agent:set-panel-occluded', true, 'chat-default', false],
      ['browser-agent:set-panel-occluded', false, 'chat-explicit-false', false],
      ['browser-agent:set-panel-occluded', true, 'chat-force', true],
      ['browser-agent:search-suggestions', 'sim ai'],
      ['desktop:settings:set-browser-search-suggestions', false],
    ])
    expect(send).toHaveBeenCalledWith('browser-agent:register-site-permission-prompt-support')
  })

  it('exposes native microphone settings only on supported platforms', async () => {
    const exposed = exposeInMainWorld.mock.calls.find(([name]) => name === 'simDesktop')?.[1] as
      | SimDesktopApi
      | undefined
    if (!exposed) throw new Error('Expected the desktop preload API to be exposed')

    const isSupportedPlatform = process.platform === 'darwin' || process.platform === 'win32'
    expect(typeof exposed.openMicrophoneSettings).toBe(
      isSupportedPlatform ? 'function' : 'undefined'
    )

    if (isSupportedPlatform) {
      await exposed.openMicrophoneSettings?.()
      expect(invoke).toHaveBeenLastCalledWith('desktop:open-microphone-settings')
    }
  })
})
