import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachLoadHealth, classifyLoadError } from '@/main/load-health'
import { BrowserWindow as MockBrowserWindow } from '@/test/electron-mock'

describe('classifyLoadError', () => {
  it('ignores aborted navigations (OAuth redirects abort constantly)', () => {
    expect(classifyLoadError(-3)).toBe('ignored')
    expect(classifyLoadError(0)).toBe('ignored')
  })

  it('does NOT ignore ERR_FAILED (-2) or ERR_IO_PENDING (-1)', () => {
    expect(classifyLoadError(-2)).toBe('unreachable')
    expect(classifyLoadError(-1)).toBe('unreachable')
  })

  it('classifies connectivity failures', () => {
    expect(classifyLoadError(-106)).toBe('offline')
    expect(classifyLoadError(-105)).toBe('dns')
    expect(classifyLoadError(-137)).toBe('dns')
    expect(classifyLoadError(-7)).toBe('timeout')
    expect(classifyLoadError(-118)).toBe('timeout')
  })

  it('classifies TLS failures', () => {
    expect(classifyLoadError(-200)).toBe('tls')
    expect(classifyLoadError(-201)).toBe('tls')
    expect(classifyLoadError(-213)).toBe('tls')
  })

  it('falls back to unreachable for other network errors', () => {
    expect(classifyLoadError(-102)).toBe('unreachable')
    expect(classifyLoadError(-21)).toBe('unreachable')
    expect(classifyLoadError(-324)).toBe('unreachable')
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

  it('swaps a failed origin load for the bundled offline page', () => {
    const { win, events, failLoad } = setup()

    failLoad(-105, 'ERR_NAME_NOT_RESOLVED', 'https://sim.example.com/workspace')

    expect(win.loadURL).toHaveBeenCalledWith(
      'sim-shell://pages/offline.html?kind=dns&detail=ERR_NAME_NOT_RESOLVED%20(-105)'
    )
    expect(events.record).toHaveBeenCalledWith('load_failure', {
      kind: 'dns',
      detail: 'ERR_NAME_NOT_RESOLVED (-105)',
    })
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

  // Stopping the retry instead would strand the window blank until a relaunch.
  // The origin keeps being retried on the usual cadence; only the broken
  // bundled page is never navigated to again.
  it('keeps retrying the origin after the offline page broke, without reloading it', () => {
    const { win, events, failLoad } = setup()

    failLoad(-105, 'ERR_NAME_NOT_RESOLVED', 'https://sim.example.com/workspace')
    failLoad(-6, 'ERR_FILE_NOT_FOUND', 'sim-shell://pages/offline.html?kind=dns')
    vi.advanceTimersByTime(5000)

    expect(win.loadURL).toHaveBeenCalledTimes(2)
    expect(win.loadURL).toHaveBeenLastCalledWith('https://sim.example.com/workspace')

    failLoad(-105, 'ERR_NAME_NOT_RESOLVED', 'https://sim.example.com/workspace')
    vi.advanceTimersByTime(5000)

    expect(events.record).toHaveBeenCalledTimes(2)
    expect(win.loadURL).toHaveBeenCalledTimes(3)
    expect(win.loadURL).toHaveBeenLastCalledWith('https://sim.example.com/workspace')
  })
})
