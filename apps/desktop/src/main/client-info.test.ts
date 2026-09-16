import { beforeEach, describe, expect, it, vi } from 'vitest'

// client-info pulls in @/main/navigation, which imports electron.
vi.mock('electron', () => import('@/test/electron-mock'))

import { attachClientInfo, desktopClientInfo } from '@/main/client-info'

type BeforeSendHeadersHandler = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: (response: { requestHeaders?: Record<string, string> }) => void
) => void

function fakeSession() {
  let handler: BeforeSendHeadersHandler | undefined
  const ses = {
    webRequest: {
      onBeforeSendHeaders: vi.fn((h: BeforeSendHeadersHandler) => {
        handler = h
      }),
    },
  }
  return { ses, run: () => handler }
}

const APP_ORIGIN = 'https://sim.ai'
const CLIENT_INFO = desktopClientInfo()

describe('desktopClientInfo', () => {
  it('names the shell, its runtime, and the platform', () => {
    expect(desktopClientInfo()).toMatch(
      new RegExp(
        `^desktop/1\\.0\\.0(; electron/[^;]+)?; os/${process.platform}; arch/${process.arch}$`
      )
    )
  })
})

describe('attachClientInfo', () => {
  let session: ReturnType<typeof fakeSession>

  beforeEach(() => {
    session = fakeSession()
    attachClientInfo(
      session.ses as unknown as Parameters<typeof attachClientInfo>[0],
      () => APP_ORIGIN
    )
  })

  it('stamps the shell identity on an app-origin request', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: `${APP_ORIGIN}/api/workflows`, requestHeaders: { Accept: 'application/json' } },
      cb
    )
    expect(cb).toHaveBeenCalledWith({
      requestHeaders: { Accept: 'application/json', 'x-sim-client-info': CLIENT_INFO },
    })
  })

  it('overwrites the web value the page sent, whatever its casing', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: `${APP_ORIGIN}/api/workflows`, requestHeaders: { 'X-Sim-Client-Info': 'web' } },
      cb
    )
    expect(cb).toHaveBeenCalledWith({
      requestHeaders: { 'x-sim-client-info': CLIENT_INFO },
    })
  })

  it('leaves requests to other origins untouched', () => {
    const cb = vi.fn()
    session.run()?.(
      { url: 'https://accounts.google.com/o/oauth2', requestHeaders: { Accept: '*/*' } },
      cb
    )
    expect(cb).toHaveBeenCalledWith({})
  })
})
