import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachLoadHealth, classifyLoadError } from '@/main/load-health'
import { BrowserWindow as MockBrowserWindow } from '@/test/electron-mock'

describe('classifyLoadError', () => {
  const SELF_HOSTED_URL = 'http://sim.corp.internal:3000/workspace'

  it('does NOT ignore ERR_FAILED (-2) or ERR_IO_PENDING (-1)', () => {
    expect(classifyLoadError(-2, SELF_HOSTED_URL)).toBe('unreachable')
    expect(classifyLoadError(-1, SELF_HOSTED_URL)).toBe('unreachable')
  })

  it('reports ERR_ADDRESS_UNREACHABLE as a local-network block only under Local Network privacy', () => {
    expect(classifyLoadError(-109, SELF_HOSTED_URL, true)).toBe('local_network')
    expect(classifyLoadError(-109, SELF_HOSTED_URL, false)).toBe('unreachable')
  })

  it('never blames Local Network privacy for Sim Cloud, which is public', () => {
    expect(classifyLoadError(-109, 'https://www.sim.ai/workspace', true)).toBe('unreachable')
  })
})

vi.mock('electron', () => import('@/test/electron-mock'))

describe('attachLoadHealth', () => {
  function setup() {
    vi.useFakeTimers()
    const win = new MockBrowserWindow()
    const events = { record: vi.fn() }
    attachLoadHealth(win as never, {
      offlinePageUrl: ({ kind, detail }) =>
        `sim-shell://pages/offline.html?kind=${kind}&detail=${encodeURIComponent(detail)}`,
      getStartUrl: () => 'https://sim.example.com/workspace',
      isOnline: () => true,
      events: events as never,
    })
    const failLoad = (errorCode: number, description: string, url: string) => {
      const handler = win.webContents.on.mock.calls.find(([name]) => name === 'did-fail-load')?.[1]
      if (!handler) throw new Error('no did-fail-load handler')
      ;(handler as (...args: unknown[]) => void)({}, errorCode, description, url, true)
    }
    return { win, events, failLoad }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  // A packaged build once failed to load the offline page itself and re-showed
  // it on every failure; that must stop at the first one.
  it('does not loop when the offline page itself fails to load', () => {
    const { win, events, failLoad } = setup()

    failLoad(-105, 'ERR_NAME_NOT_RESOLVED', 'https://sim.example.com/workspace')
    failLoad(-6, 'ERR_FILE_NOT_FOUND', 'sim-shell://pages/offline.html?kind=dns')

    expect(win.loadURL).toHaveBeenCalledTimes(1)
    expect(events.record).toHaveBeenCalledTimes(1)
  })
})
