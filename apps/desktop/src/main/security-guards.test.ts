import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { WebContents } from 'electron'
import { app, shell } from 'electron'
import { attachNavigationGuards, type GuardDeps, installGlobalGuards } from '@/main/security-guards'

const APP = 'https://sim.ai'

interface FakeContents {
  handlers: Map<string, (event: { preventDefault: () => void }, url: string) => void>
  on: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  closeDevTools: ReturnType<typeof vi.fn>
}

function makeContents(currentUrl: string): FakeContents {
  const handlers = new Map()
  return {
    handlers,
    on: vi.fn((event: string, handler: never) => {
      handlers.set(event, handler)
    }),
    getURL: vi.fn(() => currentUrl),
    setWindowOpenHandler: vi.fn(),
    closeDevTools: vi.fn(),
  }
}

function makeDeps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    appOrigin: () => APP,
    isPackaged: true,
    allowHttpLocalhost: () => false,
    isPopupContents: () => false,
    onLoginHandoff: vi.fn(),
    onConnectIntercept: vi.fn(),
    ...overrides,
  }
}

function fire(contents: FakeContents, event: string, url: string) {
  const preventDefault = vi.fn()
  contents.handlers.get(event)?.({ preventDefault }, url)
  return preventDefault
}

describe('attachNavigationGuards', () => {
  beforeEach(() => {
    vi.mocked(shell.openExternal).mockClear()
  })

  it('guards both will-navigate and will-redirect', () => {
    const contents = makeContents(`${APP}/login`)
    attachNavigationGuards(contents as unknown as WebContents, makeDeps())
    expect(contents.handlers.has('will-navigate')).toBe(true)
    expect(contents.handlers.has('will-redirect')).toBe(true)
  })

  it('lets same-origin navigation through untouched', () => {
    const contents = makeContents(`${APP}/workspace/ws1`)
    attachNavigationGuards(contents as unknown as WebContents, makeDeps())
    const preventDefault = fire(contents, 'will-navigate', `${APP}/workspace/ws1/w/wf1`)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('cancels blocked-IdP login navigation and starts the browser handoff', () => {
    const deps = makeDeps()
    const contents = makeContents(`${APP}/login`)
    attachNavigationGuards(contents as unknown as WebContents, deps)
    const preventDefault = fire(
      contents,
      'will-navigate',
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(deps.onLoginHandoff).toHaveBeenCalled()
  })

  it('cancels blocked-IdP connect navigation via will-redirect and intercepts', () => {
    const deps = makeDeps()
    const contents = makeContents(`${APP}/workspace/ws1/integrations/gmail`)
    attachNavigationGuards(contents as unknown as WebContents, deps)
    const preventDefault = fire(
      contents,
      'will-redirect',
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(deps.onConnectIntercept).toHaveBeenCalled()
  })

  it('denies non-web schemes', () => {
    const contents = makeContents(`${APP}/workspace/ws1`)
    attachNavigationGuards(contents as unknown as WebContents, makeDeps())
    const preventDefault = fire(contents, 'will-navigate', 'file:///etc/passwd')
    expect(preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('installGlobalGuards', () => {
  it('hardens every created WebContents and rejects TLS errors', () => {
    const appOn = vi.mocked(app.on)
    appOn.mockClear()
    installGlobalGuards(makeDeps())

    const registrations = appOn.mock.calls as unknown as Array<
      [string, (...args: unknown[]) => void]
    >
    const created = registrations.find(([event]) => event === 'web-contents-created')
    expect(created).toBeDefined()
    const contents = makeContents(`${APP}/workspace`)
    ;(created?.[1] as (event: unknown, contents: unknown) => void)(undefined, contents)

    expect(contents.setWindowOpenHandler).toHaveBeenCalled()
    const defaultHandler = contents.setWindowOpenHandler.mock.calls[0][0] as () => {
      action: string
    }
    expect(defaultHandler()).toEqual({ action: 'deny' })

    const webviewGuard = contents.handlers.get('will-attach-webview')
    const preventDefault = vi.fn()
    ;(webviewGuard as unknown as (event: { preventDefault: () => void }) => void)?.({
      preventDefault,
    })
    expect(preventDefault).toHaveBeenCalled()

    expect(contents.handlers.has('devtools-opened')).toBe(true)

    const certHandler = registrations.find(([event]) => event === 'certificate-error')
    expect(certHandler).toBeDefined()
    const certPreventDefault = vi.fn()
    const callback = vi.fn()
    ;(certHandler?.[1] as (...args: unknown[]) => void)(
      { preventDefault: certPreventDefault },
      contents,
      'https://bad-cert.example',
      'ERR_CERT_AUTHORITY_INVALID',
      {},
      callback
    )
    expect(certPreventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(false)
  })
})
