import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { browserUserAgent, stockChromeUserAgent } from '@/main/browser-agent/user-agent'

vi.mock('electron', () => import('@/test/electron-mock'))

const ELECTRON_DEFAULT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sim/1.0.0 Chrome/140.0.7339.207 Electron/43.1.1 Safari/537.36'

describe('stockChromeUserAgent', () => {
  it('drops the application and Electron tokens a browser allowlist rejects', () => {
    const agent = stockChromeUserAgent(ELECTRON_DEFAULT)
    expect(agent).not.toMatch(/Electron/)
    expect(agent).not.toMatch(/Sim\//)
  })

  it('reproduces the desktop string Chrome sends under user-agent reduction', () => {
    expect(stockChromeUserAgent(ELECTRON_DEFAULT)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    )
  })

  it('keeps the platform token of the machine it is running on', () => {
    const windowsDefault =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sim/1.0.0 Chrome/140.0.7339.207 Electron/43.1.1 Safari/537.36'
    expect(stockChromeUserAgent(windowsDefault)).toContain('(Windows NT 10.0; Win64; x64)')
  })

  it('passes through a string that is not a Chromium user agent', () => {
    expect(stockChromeUserAgent('curl/8.4.0')).toBe('curl/8.4.0')
    expect(stockChromeUserAgent('')).toBe('')
  })
})

describe('browserUserAgent', () => {
  it('derives from the string Electron would otherwise have sent', () => {
    app.userAgentFallback = ELECTRON_DEFAULT

    expect(browserUserAgent()).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    )
  })
})
