import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { WebContents } from 'electron'
import { shell } from 'electron'
import { attachWindowOpenPolicy, isPopupContents, registerPopupContents } from '@/main/windows'

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

  function setup() {
    const contents = makeContents()
    const openAppWindow = vi.fn()
    attachWindowOpenPolicy(contents as unknown as WebContents, {
      appOrigin: () => APP,
      openAppWindow,
      allowHttpLocalhost: false,
    })
    return { contents, openAppWindow }
  }

  it('allows the MCP OAuth popup', () => {
    const { contents } = setup()
    const result = contents.handler?.({
      url: 'https://mcp.example/authorize',
      frameName: 'mcp-oauth-s1',
    })
    expect(result).toEqual({ action: 'allow' })
  })

  it('allows blank children for the blank-then-assign pattern', () => {
    const { contents } = setup()
    expect(contents.handler?.({ url: 'about:blank', frameName: '' })).toEqual({ action: 'allow' })
  })

  it('opens internal new-window requests as full Sim windows', () => {
    const { contents, openAppWindow } = setup()
    const result = contents.handler?.({ url: `${APP}/workspace/ws1/w/wf1`, frameName: '' })
    expect(result).toEqual({ action: 'deny' })
    expect(openAppWindow).toHaveBeenCalledWith(`${APP}/workspace/ws1/w/wf1`)
  })

  it('routes external opens to the system browser', () => {
    const { contents } = setup()
    const result = contents.handler?.({ url: 'https://docs.sim.ai/blocks', frameName: '' })
    expect(result).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://docs.sim.ai/blocks')
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

describe('popup registry', () => {
  it('tracks popup contents identity', () => {
    const contents = {} as WebContents
    expect(isPopupContents(contents)).toBe(false)
    registerPopupContents(contents)
    expect(isPopupContents(contents)).toBe(true)
  })
})
