import { app } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installBrowserUserAgent, stockChromeUserAgent } from '@/main/user-agent'

vi.mock('electron', () => import('@/test/electron-mock'))

const ELECTRON_DEFAULT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sim/1.0.0 Chrome/140.0.7339.207 Electron/43.1.1 Safari/537.36'
const STOCK_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('stockChromeUserAgent', () => {
  it('drops the application and Electron tokens a browser allowlist rejects', () => {
    const agent = stockChromeUserAgent(ELECTRON_DEFAULT)
    expect(agent).not.toMatch(/Electron/)
    expect(agent).not.toMatch(/Sim\//)
  })
})

describe('installBrowserUserAgent', () => {
  it('idempotently makes stock Chrome the process-wide fallback every request path uses', () => {
    app.userAgentFallback = ELECTRON_DEFAULT

    installBrowserUserAgent()
    installBrowserUserAgent()

    expect(app.userAgentFallback).toBe(STOCK_CHROME)
  })
})
