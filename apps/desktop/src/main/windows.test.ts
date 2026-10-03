import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { WebContents } from 'electron'
import { shell } from 'electron'
import { attachWindowOpenPolicy } from '@/main/windows'

const APP = 'https://sim.ai'

interface FakeContents {
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  handler?: (details: { url: string; frameName: string }) => { action: string }
}

function makeContents(): FakeContents {
  const contents: FakeContents = {
    setWindowOpenHandler: vi.fn((handler) => {
      contents.handler = handler
    }),
    on: vi.fn(),
  }
  return contents
}

describe('attachWindowOpenPolicy', () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear()
  })

  function setup(isCommittedRelaunchPending: () => boolean = () => false) {
    const contents = makeContents()
    const openAppWindow = vi.fn()
    attachWindowOpenPolicy(contents as unknown as WebContents, {
      appOrigin: () => APP,
      openAppWindow,
      allowHttpLocalhost: false,
      isCommittedRelaunchPending,
    })
    return { contents, openAppWindow }
  }

  it('allows the MCP OAuth popup', () => {
    const { contents } = setup()
    const result = contents.handler?.({
      url: 'https://mcp.example/authorize',
      frameName: 'mcp-oauth-s1',
    })
    expect(result).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: expect.objectContaining({
          preload: undefined,
          additionalArguments: [],
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        }),
      },
    })
  })

  it('denies non-web schemes without opening anything', () => {
    const { contents, openAppWindow } = setup()
    const result = contents.handler?.({ url: 'javascript:alert(1)', frameName: '' })
    expect(result).toEqual({ action: 'deny' })
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(openAppWindow).not.toHaveBeenCalled()
  })

  it('registers guards on created child windows', () => {
    const { contents } = setup()
    const didCreateWindow = contents.on.mock.calls.find(([event]) => event === 'did-create-window')
    expect(didCreateWindow).toBeDefined()
  })
})
